// Runs agents: one claude process per agent at a time (further messages
// queue), a small global cap on parallel runs, usage-limit pausing, and the
// one-off runs that carry out approved actions.
import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { MODEL_IDS, type AgentConfig, type ChatMessage, type ProposedAction } from '@shared/types'
import type { AgentStore } from './agents'
import type { Db } from './db'
import { childEnv } from './env'
import { agentNotes, approvalOnlyTools, configuredServersFor, writeRunConfig } from './mcp'
import { googleReady } from './gmail'
import { workspaceOf } from './paths'
import { hasInstalledSkills, SKILLS_PLUGIN } from './skills'
import { currentTimeLine, executePrompt, systemPrompt } from './claude/prompt'
import { spawnClaude, type ClaudeProcess } from './claude/process'
import { extractActions, extractHandoffs, hideActionsBlock, StreamState, type RunTokens } from './claude/stream'
import { resolveHandoffs, rosterFor } from './handoff'
import { looksLikeUsageLimit, type UsageTracker } from './usage'

const RUN_TIMEOUT = 15 * 60_000
const ACTION_TIMEOUT = 3 * 60_000
const ROOM_TURN_TIMEOUT = 5 * 60_000
const MAX_PARALLEL = 3
const EMIT_EVERY_MS = 70

/** Built-in tools agents may use. File tools are confined to the agent's workspace. */
// (TodoWrite used to be here; Claude Code replaced it with Task* tools, so it no longer exists.)
const BASE_TOOLS = ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'WebSearch', 'WebFetch']

export interface Job {
  source: 'chat' | 'routine'
  prompt: string
  /** Paths relative to the agent's workspace. */
  attachments: string[]
  retried?: boolean
  /** Routines running late (the Mac was asleep or NateBot closed): when they were due. */
  dueAt?: number
}

interface Running {
  job: Job
  proc: ClaudeProcess | null
  stopped: boolean
  dropped: number
  message: ChatMessage
}

export interface RunFinished {
  agentId: string
  source: Job['source']
  ok: boolean
  summary: string
  needsApproval: boolean
  /** The agent message the run produced (its proposed actions, if any). */
  messageId: string
  /** Who the run suggests handing a task to, waiting for the user's OK. */
  handoffTo?: string
}

/** One agent's turn in a group chat. */
export interface RoomTurn {
  roomId: string
  agent: AgentConfig
  /** The agent's room-only session (null starts a new one). */
  sessionId: string | null
  /** Appended to the agent's system prompt; must stay the same between turns (prompt cache). */
  roomPrompt: string
  input: string
  onSession: (sessionId: string) => void
}

export interface RoomTurnResult {
  status: 'ok' | 'stopped' | 'limited' | 'session-lost' | 'error'
  /** The visible reply; empty when the agent passed. */
  text: string
  detail: string
}

/** Agents in a group chat reply "PASS" when they have nothing to add. */
const PASS_RE = /^\W*pass\W*$/i
const PASS_PREFIX_RE = /^\W*p(a(s(s)?)?)?\W*$/i

export interface EngineDeps {
  store: AgentStore
  db: Db
  usage: UsageTracker
  claudePath: () => string | null
  emitMessage: (m: ChatMessage) => void
  emitAgents: () => void
}

class UserFacingError extends Error {}

const firstLine = (text: string): string =>
  (text.split('\n').find((l) => l.trim()) ?? '').replace(/[*_`#>]/g, '').trim().slice(0, 200)

const tail = (text: string, lines = 6): string => text.trim().split('\n').slice(-lines).join('\n').trim()

export function ensureWorkspace(agentId: string): string {
  const dir = workspaceOf(agentId)
  mkdirSync(`${dir}/attachments`, { recursive: true })
  return dir
}

/** Built-in tool names referenced by the agent's allow-list (e.g. "Bash(git *)" → "Bash"). */
function builtinTools(agent: AgentConfig): string[] {
  const extra = agent.allowed_tools.filter((t) => !t.startsWith('mcp__')).map((t) => t.replace(/\(.*$/, ''))
  return [...new Set([...BASE_TOOLS, ...extra])]
}

export class Engine extends EventEmitter {
  private queues = new Map<string, Job[]>()
  private running = new Map<string, Running>()
  private roomProcs = new Map<string, ClaudeProcess>()
  private resumeTimer: NodeJS.Timeout | undefined

  constructor(private deps: EngineDeps) {
    super()
  }

  status(agentId: string): { running: boolean; queued: number } {
    return { running: this.running.has(agentId), queued: this.queues.get(agentId)?.length ?? 0 }
  }

  /** The in-progress message for an agent, if it is streaming. */
  liveMessage(agentId: string): ChatMessage | null {
    return this.running.get(agentId)?.message ?? null
  }

  enqueue(agentId: string, job: Job): void {
    const q = this.queues.get(agentId) ?? []
    q.push(job)
    this.queues.set(agentId, q)
    this.deps.emitAgents()
    this.pump()
  }

  /** Stops the current run and cancels queued messages. */
  stop(agentId: string): void {
    const q = this.queues.get(agentId) ?? []
    const dropped = q.length
    this.queues.set(agentId, [])
    const r = this.running.get(agentId)
    if (r) {
      r.stopped = true
      r.dropped = dropped
      r.proc?.kill('stopped')
    } else if (dropped) {
      this.system(agentId, `Cancelled ${dropped} queued message${dropped > 1 ? 's' : ''}`)
    }
    this.deps.emitAgents()
  }

  shutdown(): void {
    clearTimeout(this.resumeTimer)
    for (const r of this.running.values()) {
      r.stopped = true
      r.proc?.kill('stopped')
    }
    for (const proc of this.roomProcs.values()) proc.kill('stopped')
  }

  /** Starts queued jobs while there's capacity and usage allows. */
  pump(): void {
    const wait = this.deps.usage.waitMs()
    clearTimeout(this.resumeTimer)
    if (wait > 0) {
      this.resumeTimer = setTimeout(() => this.pump(), wait + 5_000)
      return
    }
    for (const [agentId, q] of this.queues) {
      if (this.running.size >= MAX_PARALLEL) break
      if (this.running.has(agentId) || q.length === 0) continue
      if (!this.deps.store.get(agentId)) {
        this.queues.delete(agentId)
        continue
      }
      const job = q.shift() as Job
      void this.run(agentId, job)
    }
  }

  // ---- helpers ----

  private save(m: ChatMessage): void {
    this.deps.db.saveMessage(m)
    this.deps.emitMessage({ ...m, tools: m.tools?.map((t) => ({ ...t })) })
  }

  system(agentId: string, text: string): void {
    this.save({ id: randomUUID(), agentId, role: 'system', text, createdAt: Date.now() })
  }

  private buildInput(job: Job, notes: string[]): string {
    const parts: string[] = [currentTimeLine()]
    if (notes.length) parts.push(`[NateBot notes since your last reply]\n${notes.map((n) => `- ${n}`).join('\n')}`)
    if (job.source === 'routine') {
      parts.push(
        job.dueAt
          ? `[Scheduled routine run, due at ${new Date(job.dueAt).toLocaleString('en-GB', { weekday: 'long', hour: '2-digit', minute: '2-digit' })}. It's running late because the Mac was asleep or NateBot was closed.]`
          : '[Scheduled routine run]'
      )
    }
    parts.push(job.prompt || 'Please look at the attached file(s).')
    if (job.attachments.length) {
      parts.push(`[Attached files, saved in your working folder]\n${job.attachments.map((a) => `- ${a}`).join('\n')}`)
    }
    return parts.join('\n\n')
  }

  private runArgs(
    agent: AgentConfig,
    mcpPath: string,
    mcpServers: string[],
    sessionArgs: string[],
    // One-on-one chats can hand tasks to the other agents (group chats pass their own prompt).
    prompt = systemPrompt(agent, agentNotes(agent), rosterFor(agent, this.deps.store.list()))
  ): string[] {
    const allowed = [...new Set([...agent.allowed_tools, ...mcpServers.map((s) => `mcp__${s}`)])]
    // Tools marked require_approval in mcp.json are never available in normal runs.
    const disallowed = [...new Set([...agent.disallowed_tools, ...approvalOnlyTools(agent)])]
    const args = [
      '-p',
      '--output-format', 'stream-json',
      '--verbose',
      '--include-partial-messages',
      '--model', MODEL_IDS[agent.model],
      '--effort', agent.effort,
      '--append-system-prompt', prompt,
      // Re-render the system prompt on resume so edited instructions apply.
      '--system-prompt-snapshot', 'off',
      // Ignore the user's own Claude Code settings, hooks and plugins.
      '--setting-sources', 'project,local',
      '--strict-mcp-config', '--mcp-config', mcpPath,
      // Edits are auto-accepted only inside the workspace; anything else that
      // would need permission is refused instead of waiting for a prompt.
      '--permission-mode', 'acceptEdits',
      '--permission-prompts', 'none',
      '--tools', builtinTools(agent).join(','),
      // Claude Code's bundled skills (code-review, loop, schedule…) are useless to
      // agents and cost ~1.5k tokens per message whenever the Skill tool is on.
      // This removes them without affecting Marketplace skills (--plugin-dir).
      // design/doctor/plugin-authoring aren't covered by disableBundledSkills, so they're listed.
      '--settings', JSON.stringify({ disableBundledSkills: true, skillOverrides: { design: 'off', doctor: 'off', 'plugin-authoring': 'off' } })
    ]
    // Marketplace skills live in a NateBot-owned plugin; agents invoke them with the Skill tool.
    if (hasInstalledSkills()) {
      const i = args.indexOf('--tools')
      args[i + 1] = `${args[i + 1]},Skill`
      args.push('--plugin-dir', SKILLS_PLUGIN)
    }
    if (allowed.length) args.push('--allowedTools', allowed.join(','))
    if (disallowed.length) args.push('--disallowedTools', disallowed.join(','))
    return [...args, ...sessionArgs]
  }

  // ---- a normal run ----

  private async run(agentId: string, job: Job): Promise<void> {
    const agent = this.deps.store.require(agentId)
    const msg: ChatMessage = { id: randomUUID(), agentId, role: 'agent', text: '', createdAt: Date.now(), streaming: true, tools: [] }
    const r: Running = { job, proc: null, stopped: false, dropped: 0, message: msg }
    this.running.set(agentId, r)
    this.deps.emitAgents()
    this.save(msg)

    const runId = randomUUID()
    this.deps.db.startRun(runId, agentId, job.source)
    const notes = this.deps.db.takeNotes(agentId)
    const extraLines: { role: 'system' | 'error'; text: string }[] = []
    let ok = false
    let requeue = false
    let summary = ''
    let mcp: ReturnType<typeof writeRunConfig> | null = null
    let tokens: RunTokens | null = null

    try {
      const bin = this.deps.claudePath()
      if (!bin) throw new UserFacingError("Claude Code isn't available. Open Settings to check the path to the claude program.")
      // Gmail's sign-in can't complete inside a short agent run (its callback dies with
      // the run), so agents only get Gmail once Connect Gmail has stored a token.
      const skip = agent.mcp_servers.filter((s) => !googleReady(s))
      if (skip.length) {
        const names = skip.map((s) => (s === 'gcal' ? 'Calendar' : 'Gmail')).join(' and ')
        extraLines.push({ role: 'system', text: `${names} isn't connected yet, so this reply didn't use it. Connect it in Settings → Connected tools.` })
      }
      mcp = writeRunConfig(agent, skip)
      const sessionArgs = agent.session_id ? ['--resume', agent.session_id] : ['--session-id', randomUUID()]
      const state = new StreamState()

      let emitTimer: NodeJS.Timeout | undefined
      const flush = (): void => {
        emitTimer = undefined
        msg.text = hideActionsBlock(state.text)
        msg.tools = state.tools.map((t) => ({ ...t }))
        this.deps.emitMessage({ ...msg })
      }

      r.proc = spawnClaude({
        bin,
        args: this.runArgs(agent, mcp.path, mcp.servers, sessionArgs),
        cwd: ensureWorkspace(agent.id),
        env: childEnv(),
        input: this.buildInput(job, notes),
        timeoutMs: RUN_TIMEOUT,
        onEvent: (ev) => {
          const changed = state.handle(ev)
          if (ev['type'] === 'rate_limit_event' && state.rateLimit) this.deps.usage.update(state.rateLimit)
          // Remember the session as soon as it exists, so memory survives a Stop.
          if (ev['type'] === 'system' && ev['subtype'] === 'init' && state.sessionId) {
            this.deps.store.setSession(agentId, state.sessionId)
          }
          if (changed && !emitTimer) emitTimer = setTimeout(flush, EMIT_EVERY_MS)
        }
      })
      if (r.stopped) r.proc.kill('stopped')

      const exit = await r.proc.done
      clearTimeout(emitTimer)
      tokens = state.result?.tokens ?? null
      msg.tools = state.tools.map((t) => (t.status === 'running' ? { ...t, status: 'error' as const } : { ...t }))

      if (exit.reason === 'spawn-error') throw new UserFacingError(`Couldn't start Claude Code: ${exit.error ?? 'unknown error'}`)

      if (exit.reason === 'stopped') {
        msg.text = hideActionsBlock(state.text)
        summary = 'Stopped'
        const note = r.dropped ? `Stopped · ${r.dropped} queued message${r.dropped > 1 ? 's' : ''} cancelled` : 'Stopped'
        extraLines.push({ role: 'system', text: note })
      } else if (exit.reason === 'timeout') {
        msg.text = hideActionsBlock(state.text)
        summary = 'Timed out'
        extraLines.push({ role: 'error', text: 'This took longer than 15 minutes, so NateBot stopped it.' })
      } else if (state.result && !state.result.isError) {
        const parsed = extractActions(state.text || state.result.text)
        const handed = extractHandoffs(parsed.text)
        const { handoffs, problems } = resolveHandoffs(handed.handoffs, agent, this.deps.store.list())
        msg.text = handed.text
        if (parsed.actions.length) msg.actions = parsed.actions
        if (handoffs.length) msg.handoffs = handoffs
        for (const text of [parsed.error, handed.error, ...problems]) if (text) extraLines.push({ role: 'error', text })
        ok = true
        summary =
          firstLine(handed.text) ||
          (parsed.actions.length ? `${parsed.actions.length} action(s) to approve` : handoffs.length ? `Suggests handing off to ${handoffs[0]?.toName}` : 'Done')
      } else {
        const detail = (state.result?.text || tail(exit.stderr) || `Claude Code exited with code ${exit.code ?? '?'}`).trim()
        if (looksLikeUsageLimit(detail) || state.rateLimit?.status === 'rejected') {
          this.deps.usage.markLimited(detail)
          requeue = true
          summary = 'Usage limit reached'
          extraLines.push({ role: 'system', text: 'Usage limit reached. This will run automatically when your limit resets.' })
        } else if (agent.session_id && /no conversation found|session.*not found|invalid session/i.test(detail) && !job.retried) {
          this.deps.store.setSession(agentId, null)
          job.retried = true
          requeue = true
          summary = 'Starting fresh session'
          extraLines.push({ role: 'system', text: "Couldn't find this agent's previous memory, so it's starting a fresh conversation." })
        } else {
          throw new UserFacingError(detail)
        }
      }
    } catch (e) {
      const text = e instanceof UserFacingError ? e.message : `Something went wrong: ${(e as Error).message}`
      extraLines.push({ role: 'error', text })
      summary = text
    } finally {
      mcp?.cleanup()
    }

    // Keep notes for next time if this run didn't get through.
    if (!ok) for (const n of notes) this.deps.db.addNote(agentId, n)

    msg.streaming = false
    const hasContent = !!(msg.text || msg.tools?.length || msg.actions?.length || msg.handoffs?.length)
    if (hasContent) {
      this.save(msg)
      if (msg.text || msg.actions?.length || msg.handoffs?.length) this.deps.db.bumpUnread(agentId)
    } else {
      // Nothing was produced: turn the placeholder into the status line.
      const first = extraLines.shift()
      if (first) this.save({ ...msg, role: first.role, text: first.text, tools: undefined })
      else this.save({ ...msg, role: 'system', text: 'No reply', tools: undefined })
    }
    for (const line of extraLines) this.save({ id: randomUUID(), agentId, role: line.role, text: line.text, createdAt: Date.now() })

    this.deps.db.finishRun(runId, ok, summary, tokens)
    this.running.delete(agentId)
    if (requeue) {
      const q = this.queues.get(agentId) ?? []
      q.unshift(job)
      this.queues.set(agentId, q)
    }
    this.deps.emitAgents()
    const finished: RunFinished = { agentId, source: job.source, ok, summary, needsApproval: !!msg.actions?.length, messageId: msg.id, handoffTo: msg.handoffs?.[0]?.toName }
    this.emit('runFinished', finished)
    this.pump()
  }

  // ---- group chat turns ----

  /** Stops whichever agent is replying in a group chat. */
  stopRoom(roomId: string): void {
    this.roomProcs.get(roomId)?.kill('stopped')
  }

  /**
   * Runs one agent's reply in a group chat. The reply streams into the room as
   * a message with speakerId set; nothing is shown if the agent passes.
   * Proposed actions are not supported in rooms and are stripped.
   */
  async roomTurn(t: RoomTurn): Promise<RoomTurnResult> {
    const { agent, roomId } = t
    const bin = this.deps.claudePath()
    if (!bin) return { status: 'error', text: '', detail: "Claude Code isn't available. Open Settings to check the path to the claude program." }
    const skip = agent.mcp_servers.filter((s) => !googleReady(s))
    const mcp = writeRunConfig(agent, skip)
    const state = new StreamState()
    const sessionArgs = t.sessionId ? ['--resume', t.sessionId] : ['--session-id', randomUUID()]
    const prompt = `${systemPrompt(agent, agentNotes(agent))}\n\n${t.roomPrompt}`
    // Recorded against the agent, so its usage stats include group chats.
    const runId = randomUUID()
    this.deps.db.startRun(runId, agent.id, 'room')
    let msg: ChatMessage | null = null
    let emitTimer: NodeJS.Timeout | undefined

    // The message only appears once it's clear the agent isn't passing.
    const flush = (): void => {
      emitTimer = undefined
      const text = hideActionsBlock(state.text).trim()
      if (!msg) {
        if (!state.tools.length && (!text || PASS_PREFIX_RE.test(text))) return
        msg = { id: randomUUID(), agentId: roomId, speakerId: agent.id, role: 'agent', text: '', createdAt: Date.now(), streaming: true, tools: [] }
        this.deps.db.saveMessage(msg)
      }
      msg.text = text
      msg.tools = state.tools.map((x) => ({ ...x }))
      this.deps.emitMessage({ ...msg })
    }

    let result: RoomTurnResult
    try {
      const proc = spawnClaude({
        bin,
        args: this.runArgs(agent, mcp.path, mcp.servers, sessionArgs, prompt),
        cwd: ensureWorkspace(agent.id),
        env: childEnv(),
        input: t.input,
        timeoutMs: ROOM_TURN_TIMEOUT,
        onEvent: (ev) => {
          const changed = state.handle(ev)
          if (ev['type'] === 'rate_limit_event' && state.rateLimit) this.deps.usage.update(state.rateLimit)
          if (ev['type'] === 'system' && ev['subtype'] === 'init' && state.sessionId) t.onSession(state.sessionId)
          if (changed && !emitTimer) emitTimer = setTimeout(flush, EMIT_EVERY_MS)
        }
      })
      this.roomProcs.set(roomId, proc)
      const exit = await proc.done
      clearTimeout(emitTimer)

      if (exit.reason === 'spawn-error') {
        result = { status: 'error', text: '', detail: `Couldn't start Claude Code: ${exit.error ?? 'unknown error'}` }
      } else if (exit.reason === 'stopped') {
        result = { status: 'stopped', text: hideActionsBlock(state.text).trim(), detail: 'Stopped' }
      } else if (exit.reason === 'timeout') {
        result = { status: 'error', text: hideActionsBlock(state.text).trim(), detail: `${agent.name} took longer than 5 minutes, so NateBot stopped it.` }
      } else if (state.result && !state.result.isError) {
        const text = extractHandoffs(extractActions(state.text || state.result.text).text).text.trim()
        result = { status: 'ok', text: PASS_RE.test(text) ? '' : text, detail: '' }
      } else {
        const detail = (state.result?.text || tail(exit.stderr) || `Claude Code exited with code ${exit.code ?? '?'}`).trim()
        if (looksLikeUsageLimit(detail) || state.rateLimit?.status === 'rejected') {
          this.deps.usage.markLimited(detail)
          result = { status: 'limited', text: '', detail }
        } else if (t.sessionId && /no conversation found|session.*not found|invalid session/i.test(detail)) {
          result = { status: 'session-lost', text: '', detail }
        } else {
          result = { status: 'error', text: '', detail }
        }
      }
    } catch (e) {
      result = { status: 'error', text: '', detail: `Something went wrong: ${(e as Error).message}` }
    } finally {
      mcp.cleanup()
      this.roomProcs.delete(roomId)
    }
    this.deps.db.finishRun(runId, result.status === 'ok', result.detail || (result.text ? 'Replied' : 'Passed'), state.result?.tokens ?? null)

    const tools = state.tools.map((x) => (x.status === 'running' ? { ...x, status: 'error' as const } : { ...x }))
    const final = msg as ChatMessage | null
    if (final) {
      final.streaming = false
      final.text = result.text
      final.tools = tools
      if (final.text || tools.length) this.save(final)
      else {
        const text = result.status === 'ok' ? `${agent.name} had nothing to add` : `${agent.name} didn't finish`
        this.save({ ...final, role: 'system', text, tools: undefined, speakerId: undefined })
      }
    }
    return result
  }

  // ---- approved actions ----

  async executeAction(agentId: string, msg: ChatMessage, action: ProposedAction): Promise<void> {
    const agent = this.deps.store.require(agentId)
    const persist = (): void => this.save(msg)

    const fail = (reason: string): void => {
      action.status = 'failed'
      action.result = reason
      persist()
      this.deps.db.addNote(agentId, `Your proposed action "${action.summary}" was approved but could not be carried out: ${reason}`)
      this.emit('actionFinished', { agentId, ok: false, summary: action.summary })
    }

    // Only a tool from one of this agent's own configured MCP servers may run.
    const tool = action.tool ?? ''
    const server = /^mcp__(.+?)__.+$/.exec(tool)?.[1]
    if (!server) return fail("The agent didn't say which tool performs this, so NateBot won't run it.")
    if (!configuredServersFor(agent).includes(server)) {
      return fail(`${tool} isn't part of this agent's connected tools.`)
    }
    if (!googleReady(server)) return fail(`${server === 'gcal' ? 'Calendar' : 'Gmail'} isn't connected. Connect it in Settings, then approve again.`)
    const bin = this.deps.claudePath()
    if (!bin) return fail("Claude Code isn't available.")
    if (this.deps.usage.waitMs() > 0) {
      this.system(agentId, 'Usage limit reached. Approve again after it resets.')
      return
    }

    action.status = 'executing'
    persist()
    const runId = randomUUID()
    this.deps.db.startRun(runId, agentId, 'action')
    const mcp = writeRunConfig(agent)
    const state = new StreamState()
    const disallowed = agent.disallowed_tools.filter((t) => t !== tool)
    const args = [
      '-p',
      '--output-format', 'stream-json',
      '--verbose',
      '--model', MODEL_IDS[agent.model],
      '--effort', 'low', // carrying out an approved action needs no deep thinking
      '--append-system-prompt', systemPrompt(agent, agentNotes(agent)),
      '--no-session-persistence',
      '--setting-sources', 'project,local',
      '--strict-mcp-config', '--mcp-config', mcp.path,
      '--permission-mode', 'default',
      '--permission-prompts', 'none',
      '--tools', '',
      '--allowedTools', tool,
      ...(disallowed.length ? ['--disallowedTools', disallowed.join(',')] : [])
    ]

    try {
      const proc = spawnClaude({
        bin,
        args,
        cwd: ensureWorkspace(agent.id),
        env: childEnv(),
        input: executePrompt(action),
        timeoutMs: ACTION_TIMEOUT,
        onEvent: (ev) => {
          state.handle(ev)
          if (ev['type'] === 'rate_limit_event' && state.rateLimit) this.deps.usage.update(state.rateLimit)
        }
      })
      const exit = await proc.done
      const used = state.tools.some((t) => t.name === tool && t.status === 'done')
      const reply = firstLine(state.text || state.result?.text || '')
      const ok = exit.reason === 'exit' && !!state.result && !state.result.isError && used && !reply.startsWith('✗')

      if (ok) {
        action.status = 'done'
        action.result = reply || '✓ Done'
        persist()
        this.save({ id: randomUUID(), agentId, role: 'agent', text: reply.startsWith('✓') ? reply : `✓ ${action.summary}`, createdAt: Date.now() })
        this.deps.db.bumpUnread(agentId)
        this.deps.db.addNote(agentId, `Your proposed action "${action.summary}" was approved and carried out: ${reply}`)
        this.deps.db.finishRun(runId, true, action.summary, state.result?.tokens ?? null)
        this.emit('actionFinished', { agentId, ok: true, summary: action.summary })
      } else {
        const reason =
          exit.reason === 'timeout'
            ? 'Timed out.'
            : // A "✓" here is a claim the checks above disproved, never a reason.
              (reply.startsWith('✓') ? '' : reply.replace(/^✗\s*/, '')) ||
              (state.result?.permissionDenials ? `Permission for ${tool} was refused.` : '') ||
              (!used ? `The tool ${tool} was never called.` : '') ||
              tail(exit.stderr, 3) ||
              'Unknown error.'
        this.deps.db.finishRun(runId, false, reason, state.result?.tokens ?? null)
        fail(reason)
      }
    } finally {
      mcp.cleanup()
      this.deps.emitAgents()
    }
  }
}
