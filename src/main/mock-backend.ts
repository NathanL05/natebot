// M1 only: an in-memory backend that implements the real API with canned data
// and fake streaming, so the UI can be reviewed without spending any usage.
// M2/M3 replace this with the claude runner, SQLite and YAML storage.
import { BrowserWindow, dialog, shell } from 'electron'
import { basename } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { NateBotApi } from '@shared/ipc'
import type {
  AgentConfig,
  AgentDraft,
  AgentSummary,
  AppSettings,
  ChatMessage,
  EnvStatus,
  McpServerInfo,
  Routine,
  RoutineInfo,
  ToolUse,
  UsageInfo
} from '@shared/types'
import { describeCron } from '@shared/schedule'
import { STARTER_AGENTS } from './starters'
import { emit } from './ipc'

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

interface QueueItem {
  text: string
  source: 'user' | 'routine'
}

interface AgentState {
  config: AgentConfig
  unread: number
  lastActivity: number
  running: boolean
  queue: QueueItem[]
  timers: NodeJS.Timeout[]
  current: ChatMessage | null
}

const MOCK_MCP: McpServerInfo[] = [
  { name: 'gmail', configured: false, description: 'Read, search and draft Gmail (set up in M6)' }
]

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'agent'
  )
}

function previewOf(msg: ChatMessage | undefined): string {
  if (!msg) return ''
  const line = msg.text.split('\n').find((l) => l.trim()) ?? ''
  return line.replace(/[*_`#>]/g, '').trim()
}

function sameRoutine(a: Routine | null, b: Routine | null): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

export class MockBackend implements NateBotApi {
  private agents = new Map<string, AgentState>()
  private messages = new Map<string, ChatMessage[]>()
  private settings: AppSettings
  private usage: UsageInfo
  private env: EnvStatus

  constructor(userName: string) {
    this.settings = {
      claudePath: null,
      defaultModel: 'sonnet',
      theme: 'dark',
      launchAtLogin: false,
      userName
    }
    this.usage = {
      status: 'allowed',
      resetsAt: Date.now() + 3 * HOUR,
      fiveHourUtilization: 0.16,
      sevenDayUtilization: 0.71,
      updatedAt: Date.now()
    }
    this.env = this.healthyEnv()
    this.seed()
  }

  // ---- debug helpers (Debug menu, dev builds only) ----

  simulateUsageLimit(on: boolean): void {
    this.usage = { ...this.usage, status: on ? 'rejected' : 'allowed', updatedAt: Date.now() }
    emit('usage', this.usage)
  }

  simulateSetupProblem(on: boolean): void {
    this.env = on
      ? { claudeFound: true, claudePath: '/Users/you/.local/bin/claude', version: '2.1.282', loggedIn: false, subscriptionType: null, error: 'Claude Code is installed but not logged in.' }
      : this.healthyEnv()
    emit('env', this.env)
  }

  private healthyEnv(): EnvStatus {
    return { claudeFound: true, claudePath: '~/.local/bin/claude (mock)', version: '2.1.282', loggedIn: true, subscriptionType: 'pro', error: null }
  }

  // ---- seed data ----

  private seed(): void {
    const t = Date.now()
    for (const config of STARTER_AGENTS) {
      this.agents.set(config.id, {
        config: structuredClone(config),
        unread: 0,
        lastActivity: t,
        running: false,
        queue: [],
        timers: [],
        current: null
      })
      this.messages.set(config.id, [])
    }

    const today8 = new Date()
    today8.setHours(8, 0, 0, 0)
    const at8 = Math.min(today8.getTime(), t - 5 * MIN)

    this.add({ agentId: 'email-agent', role: 'system', text: 'Created routine: Morning inbox sweep (weekdays at 8:00 AM)', createdAt: at8 - DAY }, false)
    this.add({ agentId: 'email-agent', role: 'system', text: 'Routine ran at 8:00 AM', createdAt: at8 }, false)
    this.add(
      {
        agentId: 'email-agent',
        role: 'agent',
        createdAt: at8 + 40_000,
        text: [
          'Morning sweep done.',
          '',
          '✓ Gmail → 42 emails scanned · 3 urgent',
          '✓ Drafts → 2 replies drafted · 0 sent',
          '',
          '**Urgent**',
          '1. **Sarah Chen** — project deadline moved up to Friday',
          '2. **Monzo** — confirm a new device sign-in',
          '3. **Landlord** — inspection Thursday at 10 am',
          '',
          'The rest is newsletters and receipts. Nothing else needs you today.'
        ].join('\n'),
        tools: [
          { id: 't1', name: 'mcp__gmail__search_threads', summary: 'is:unread newer_than:1d', status: 'done' },
          { id: 't2', name: 'mcp__gmail__get_thread', summary: '3 threads', status: 'done' },
          { id: 't3', name: 'mcp__gmail__create_draft', summary: '2 drafts', status: 'done' }
        ],
        actions: [
          {
            id: 'a1',
            type: 'send_email',
            summary: 'Reply to Sarah re: deadline',
            status: 'pending',
            details: {
              to: 'sarah.chen@example.com',
              subject: 'Re: Project deadline',
              body: "Hi Sarah,\n\nThanks for the heads-up. Friday works, I'll have the draft over by Thursday evening.\n\nNathan"
            }
          }
        ]
      },
      true
    )

    this.add({ agentId: 'planner', role: 'user', text: 'Gym at 7, lecture 10–12, and I need to finish the lab report today.', createdAt: t - DAY - 3 * HOUR }, false)
    this.add(
      {
        agentId: 'planner',
        role: 'agent',
        createdAt: t - DAY - 3 * HOUR + 20_000,
        text: [
          "Here's today:",
          '',
          '✓ 7:00 – 8:15 → Gym',
          '✓ 8:45 – 9:45 → Lab report: results section',
          '✓ 10:00 – 12:00 → Lecture',
          '✓ 13:00 – 15:30 → Lab report: discussion + references',
          '✓ 16:00 → Submit and done',
          '',
          'Which part of the report is least finished?'
        ].join('\n')
      },
      false
    )

    this.add({ agentId: 'research-helper', role: 'user', text: 'Best way to keep a Mac app running in the background?', createdAt: t - 3 * DAY }, false)
    this.add(
      {
        agentId: 'research-helper',
        role: 'agent',
        createdAt: t - 3 * DAY + 30_000,
        text: [
          '**Short answer:** a menu-bar (tray) app plus a login item.',
          '',
          '- Hide the window on close instead of quitting',
          '- Register as a login item so it starts with the Mac',
          '- Scheduled work only runs while the Mac is awake',
          '',
          'Sources: [Electron docs](https://www.electronjs.org/docs/latest/api/tray)'
        ].join('\n'),
        tools: [
          { id: 't4', name: 'WebSearch', summary: 'electron tray app login item', status: 'done' },
          { id: 't5', name: 'WebFetch', summary: 'electronjs.org/docs/latest/api/tray', status: 'done' }
        ]
      },
      false
    )
  }

  // ---- helpers ----

  private state(agentId: string): AgentState {
    const s = this.agents.get(agentId)
    if (!s) throw new Error(`Unknown agent: ${agentId}`)
    return s
  }

  private add(partial: Omit<ChatMessage, 'id'>, unread: boolean): ChatMessage {
    const msg: ChatMessage = { id: randomUUID(), ...partial }
    this.messages.get(msg.agentId)?.push(msg)
    const s = this.agents.get(msg.agentId)
    if (s) {
      s.lastActivity = Math.max(s.lastActivity, msg.createdAt)
      if (unread) s.unread++
    }
    emit('message', msg)
    return msg
  }

  private upsert(msg: ChatMessage): void {
    emit('message', { ...msg, tools: msg.tools?.map((t) => ({ ...t })) })
  }

  private summary(s: AgentState): AgentSummary {
    const list = this.messages.get(s.config.id) ?? []
    const last = [...list].reverse().find((m) => m.text.trim())
    return {
      ...s.config,
      status: s.running ? 'running' : 'idle',
      queued: s.queue.length,
      unread: s.unread,
      lastActivity: last?.createdAt ?? s.lastActivity,
      lastPreview: previewOf(last)
    }
  }

  private summaries(): AgentSummary[] {
    return [...this.agents.values()].map((s) => this.summary(s))
  }

  private emitAgents(): void {
    emit('agents', this.summaries())
  }

  private system(agentId: string, text: string): void {
    this.add({ agentId, role: 'system', text, createdAt: Date.now() }, false)
  }

  // ---- fake run loop ----

  private mockTool(config: AgentConfig): ToolUse | null {
    if (config.mcp_servers.includes('gmail')) {
      return { id: randomUUID(), name: 'mcp__gmail__search_threads', summary: 'is:unread newer_than:1d', status: 'running' }
    }
    if (config.allowed_tools.includes('WebSearch')) {
      return { id: randomUUID(), name: 'WebSearch', summary: 'searching the web', status: 'running' }
    }
    return null
  }

  private runNext(s: AgentState): void {
    const item = s.queue.shift()
    if (!item) {
      s.running = false
      s.current = null
      this.emitAgents()
      return
    }
    s.running = true
    this.emitAgents()

    const quoted = item.text.length > 60 ? `${item.text.slice(0, 57)}…` : item.text
    const reply = [
      `_Mock reply. Real Claude arrives in M2._`,
      '',
      `✓ Received → "${quoted.replace(/\n/g, ' ')}"`,
      `✓ Source → ${item.source === 'routine' ? 'routine' : 'you'}`,
      '✓ Usage → none spent'
    ].join('\n')

    const msg: ChatMessage = {
      id: randomUUID(),
      agentId: s.config.id,
      role: 'agent',
      text: '',
      createdAt: Date.now(),
      streaming: true,
      tools: []
    }
    s.current = msg
    const tool = this.mockTool(s.config)
    const later = (ms: number, fn: () => void): void => {
      s.timers.push(setTimeout(fn, ms))
    }

    later(400, () => {
      if (tool) msg.tools = [tool]
      this.upsert(msg)
    })

    later(tool ? 1800 : 900, () => {
      if (tool) tool.status = 'done'
      const tokens = reply.split(/(\s+)/)
      let i = 0
      const tick = setInterval(() => {
        msg.text += tokens.slice(i, i + 3).join('')
        i += 3
        if (i >= tokens.length) {
          clearInterval(tick)
          msg.streaming = false
          s.unread++
          s.lastActivity = Date.now()
          this.messages.get(s.config.id)?.push(msg)
          this.upsert(msg)
          s.timers = []
          this.runNext(s)
        } else {
          this.upsert(msg)
        }
      }, 35)
      s.timers.push(tick)
    })
  }

  private enqueue(s: AgentState, item: QueueItem): void {
    s.queue.push(item)
    if (!s.running) this.runNext(s)
    else this.emitAgents()
  }

  // ---- API ----

  async bootstrap() {
    return {
      agents: this.summaries(),
      settings: this.settings,
      mcpServers: MOCK_MCP,
      env: this.env,
      usage: this.usage
    }
  }

  async listMessages(agentId: string): Promise<ChatMessage[]> {
    const list = [...(this.messages.get(agentId) ?? [])]
    const current = this.agents.get(agentId)?.current
    if (current && !list.includes(current)) list.push(current)
    return list
  }

  async sendMessage(agentId: string, text: string, attachments?: string[]): Promise<void> {
    const s = this.state(agentId)
    this.add({ agentId, role: 'user', text, createdAt: Date.now(), attachments: attachments?.map((p) => basename(p)) }, false)
    this.enqueue(s, { text, source: 'user' })
  }

  async stop(agentId: string): Promise<void> {
    const s = this.state(agentId)
    if (!s.running) return
    s.timers.forEach((t) => clearTimeout(t))
    s.timers = []
    const dropped = s.queue.length
    s.queue = []
    if (s.current) {
      s.current.streaming = false
      s.current.tools?.forEach((t) => {
        if (t.status === 'running') t.status = 'error'
      })
      if (s.current.text || s.current.tools?.length) {
        this.messages.get(agentId)?.push(s.current)
        this.upsert(s.current)
      }
    }
    s.running = false
    s.current = null
    this.system(agentId, dropped ? `Stopped · ${dropped} queued message${dropped > 1 ? 's' : ''} cancelled` : 'Stopped')
    this.emitAgents()
  }

  async markRead(agentId: string): Promise<void> {
    const s = this.agents.get(agentId)
    if (s && s.unread) {
      s.unread = 0
      this.emitAgents()
    }
  }

  async pickAttachment(): Promise<string | null> {
    const win = BrowserWindow.getFocusedWindow()
    const opts = { properties: ['openFile' as const] }
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return res.canceled ? null : (res.filePaths[0] ?? null)
  }

  async createAgent(draft: AgentDraft): Promise<AgentConfig> {
    let id = slugify(draft.name)
    for (let n = 2; this.agents.has(id); n++) id = `${slugify(draft.name)}-${n}`
    const config: AgentConfig = { ...draft, id, session_id: null }
    this.agents.set(id, { config, unread: 0, lastActivity: Date.now(), running: false, queue: [], timers: [], current: null })
    this.messages.set(id, [])
    this.system(id, `Created agent: ${config.name}`)
    if (config.routine?.enabled) this.system(id, `Created routine: ${describeCron(config.routine.cron)}`)
    this.emitAgents()
    return config
  }

  async updateAgent(agent: AgentConfig): Promise<AgentConfig> {
    const s = this.state(agent.id)
    const before = s.config
    s.config = structuredClone(agent)
    if (!sameRoutine(before.routine, agent.routine)) {
      const r = agent.routine
      this.system(agent.id, r?.enabled ? `Routine set: ${describeCron(r.cron)}` : 'Routine turned off')
    }
    this.emitAgents()
    return s.config
  }

  async deleteAgent(agentId: string): Promise<void> {
    await this.stop(agentId).catch(() => undefined)
    this.agents.delete(agentId)
    this.messages.delete(agentId)
    this.emitAgents()
  }

  async resetMemory(agentId: string): Promise<void> {
    const s = this.state(agentId)
    s.config.session_id = null
    this.system(agentId, 'Memory reset. Starting a fresh conversation.')
    this.emitAgents()
  }

  async resolveAction(messageId: string, actionId: string, decision: 'approve' | 'reject', details?: Record<string, unknown>): Promise<void> {
    for (const [agentId, list] of this.messages) {
      const msg = list.find((m) => m.id === messageId)
      const action = msg?.actions?.find((a) => a.id === actionId)
      if (!msg || !action) continue
      if (action.status !== 'pending') return
      if (decision === 'reject') {
        action.status = 'rejected'
        this.upsert(msg)
        this.system(agentId, `Rejected: ${action.summary}`)
        return
      }
      if (details) action.details = details
      action.status = 'executing'
      this.upsert(msg)
      setTimeout(() => {
        action.status = 'done'
        action.result = 'Done (mock, nothing was actually sent)'
        this.upsert(msg)
        this.add({ agentId, role: 'agent', text: `✓ ${action.summary} → done _(mock)_`, createdAt: Date.now() }, true)
        this.emitAgents()
      }, 1500)
      return
    }
  }

  async listRoutines(): Promise<RoutineInfo[]> {
    return [...this.agents.values()]
      .filter((s) => s.config.routine)
      .map((s) => ({
        agentId: s.config.id,
        agentName: s.config.name,
        icon: s.config.icon,
        color: s.config.color,
        routine: s.config.routine as Routine,
        nextRun: null,
        lastRun: s.config.id === 'email-agent' ? { at: Date.now() - 2 * HOUR, ok: true, summary: '42 emails scanned · 3 urgent' } : null
      }))
  }

  async setRoutineEnabled(agentId: string, enabled: boolean): Promise<void> {
    const s = this.state(agentId)
    if (!s.config.routine) return
    await this.updateAgent({ ...s.config, routine: { ...s.config.routine, enabled } })
  }

  async runRoutineNow(agentId: string): Promise<void> {
    const s = this.state(agentId)
    if (!s.config.routine) return
    this.system(agentId, `Routine started manually · ${describeCron(s.config.routine.cron)}`)
    this.enqueue(s, { text: s.config.routine.prompt, source: 'routine' })
  }

  async updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
    this.settings = { ...this.settings, ...patch }
    return this.settings
  }

  async recheckEnv(): Promise<EnvStatus> {
    return this.env
  }

  async openExternal(url: string): Promise<void> {
    if (/^(https?:|mailto:)/i.test(url)) await shell.openExternal(url)
  }
}
