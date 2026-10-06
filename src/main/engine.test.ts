// The safety promises: tools marked require_approval are never available in a
// normal run, and an approved action can only run its one tool, from one of
// the agent's own MCP servers. claude itself is never started here.
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentConfig, ChatMessage, ProposedAction } from '@shared/types'
import type { AgentStore } from './agents'
import type { Db } from './db'
import { Engine, type RunFinished } from './engine'
import type { UsageTracker } from './usage'

type Spawn = { args: string[]; env: NodeJS.ProcessEnv; input: string }

const h = vi.hoisted(() => ({
  spawns: [] as { args: string[]; env: NodeJS.ProcessEnv; input: string }[],
  /** stream-json events the fake claude emits on its next run. */
  events: [] as Record<string, unknown>[],
  /** Makes the next spawn throw instead of starting. */
  spawnError: null as string | null
}))

vi.mock('electron', () => ({ app: { getPath: () => '/tmp' }, shell: {} }))
vi.mock(import('./paths'), async (importOriginal) => ({
  ...(await importOriginal()),
  workspaceOf: (id: string) => join(tmpdir(), 'natebot-tests', id)
}))
vi.mock('./gmail', () => ({ googleReady: () => true }))
vi.mock('./memory', () => ({ memoryBlock: () => '[Your lasting notes from memory.md]\n- Prefers short replies' }))
vi.mock('./skills', () => ({ hasInstalledSkills: () => false, SKILLS_PLUGIN: '/skills' }))
vi.mock('./mcp', () => ({
  agentNotes: () => [],
  configuredServersFor: (a: AgentConfig) => a.mcp_servers,
  approvalOnlyTools: (a: AgentConfig) => (a.mcp_servers.includes('gmail') ? ['mcp__gmail__send_gmail_message'] : []),
  writeRunConfig: (a: AgentConfig) => ({ path: '/tmp/mcp.json', servers: a.mcp_servers, cleanup: () => undefined })
}))
vi.mock('./claude/process', () => ({
  spawnClaude: (opts: { args: string[]; env: NodeJS.ProcessEnv; input: string; onEvent: (e: Record<string, unknown>) => void }) => {
    if (h.spawnError) throw new Error(h.spawnError)
    h.spawns.push({ args: opts.args, env: opts.env, input: opts.input })
    for (const e of h.events.splice(0)) opts.onEvent(e)
    return { kill: () => undefined, done: Promise.resolve({ code: 0, reason: 'exit', stderr: '' }) }
  }
}))

const emailAgent: AgentConfig = {
  id: 'email-agent',
  name: 'Email Agent',
  shape: null,
  color: '#F5A524',
  model: 'sonnet',
  effort: 'medium',
  instructions: 'Review my inbox.',
  mcp_servers: ['gmail'],
  allowed_tools: [],
  disallowed_tools: ['mcp__gmail__manage_gmail_filter'],
  quick_prompts: [],
  routines: [],
  email_triggers: [],
  read_folders: [],
  session_id: null
}

const helper: AgentConfig = { ...emailAgent, id: 'planner', name: 'Planner', instructions: 'You plan my day. Keep it short.', mcp_servers: [], disallowed_tools: [] }

const SEND = 'mcp__gmail__send_gmail_message'

const flag = (s: Spawn | undefined, name: string): string | undefined => {
  const i = s?.args.indexOf(name) ?? -1
  return i === -1 ? undefined : s?.args[i + 1]
}

const reply = (text: string, tools: { id: string; name: string; ok: boolean }[] = []): Record<string, unknown>[] => [
  { type: 'system', subtype: 'init', session_id: 'sess-1' },
  ...tools.flatMap((t) => [
    { type: 'assistant', message: { content: [{ type: 'tool_use', id: t.id, name: t.name, input: {} }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: t.id, is_error: !t.ok }] } }
  ]),
  { type: 'assistant', message: { content: [{ type: 'text', text }] } },
  { type: 'result', subtype: 'success', result: text, session_id: 'sess-1' }
]

function setup(agent: AgentConfig = emailAgent) {
  const saved: ChatMessage[] = []
  const notes: string[] = []
  const reminders: unknown[] = []
  const engine = new Engine({
    store: { get: () => agent, require: () => agent, list: () => [agent, helper], setSession: vi.fn() } as unknown as AgentStore,
    db: {
      saveMessage: (m: ChatMessage) => saved.push(structuredClone(m)),
      getMessage: (id: string) => structuredClone(saved.findLast((m) => m.id === id) ?? null),
      startRun: vi.fn(),
      finishRun: vi.fn(),
      takeNotes: () => [],
      peekNotes: () => [],
      lastAgentText: () => 'Earlier: 3 emails, none urgent.',
      recentTurns: () => [{ id: 'u', agentId: agent.id, role: 'user', text: 'Plan my week', createdAt: 1 }],
      addNote: (_id: string, n: string) => notes.push(n),
      bumpUnread: vi.fn(),
      scheduledCount: () => 0,
      saveReminder: (r: unknown) => reminders.push(r)
    } as unknown as Db,
    usage: { waitMs: () => 0, update: vi.fn(), markLimited: vi.fn() } as unknown as UsageTracker,
    claudePath: () => '/usr/local/bin/claude',
    emitMessage: vi.fn(),
    emitAgents: vi.fn(),
    lightRuns: () => true,
    user: () => ({ name: 'Nathan', about: 'Student in Galway.' })
  })
  const run = (prompt: string): Promise<RunFinished> =>
    new Promise((resolve) => {
      engine.once('runFinished', resolve)
      engine.enqueue(agent.id, { source: 'chat', prompt, attachments: [] })
    })
  return { engine, saved, notes, reminders, run }
}

const action = (over: Partial<ProposedAction> = {}): ProposedAction => ({
  id: 'act-1',
  type: 'send_email',
  summary: 'Reply to Sarah',
  tool: SEND,
  details: { to: 'sarah@example.com' },
  status: 'pending',
  ...over
})

beforeEach(() => {
  h.spawns.length = 0
  h.events.length = 0
  h.spawnError = null
  vi.stubEnv('ANTHROPIC_API_KEY', 'sk-should-never-be-passed')
})
afterEach(() => {
  vi.unstubAllEnvs()
})

describe('normal runs', () => {
  it('blocks approval-only tools and keeps the agent to its own tools', async () => {
    const { run } = setup()
    h.events.push(...reply('Inbox looks quiet.'))
    const done = await run('Sweep my inbox')
    expect(done.ok).toBe(true)

    const s = h.spawns[0]
    expect(flag(s, '--disallowedTools')?.split(',')).toEqual(['mcp__gmail__manage_gmail_filter', SEND])
    expect(flag(s, '--allowedTools')).toBe('mcp__gmail')
    expect(flag(s, '--tools')?.split(',')).not.toContain('Bash')
    expect(flag(s, '--permission-prompts')).toBe('none')
    expect(s?.args).toContain('--strict-mcp-config')
    expect(flag(s, '--setting-sources')).toBe('project,local')
  })

  it('never passes an API key to claude', async () => {
    const { run } = setup()
    h.events.push(...reply('Hi'))
    await run('Hi')
    const env = h.spawns[0]?.env ?? {}
    expect(Object.keys(env).filter((k) => k.startsWith('ANTHROPIC_'))).toEqual([])
  })

  it('turns a proposed action into a pending card without running it', async () => {
    const { run, saved } = setup()
    h.events.push(
      ...reply('Drafted a reply.\n\n```proposed_actions\n[{"type":"send_email","summary":"Reply to Sarah","tool":"mcp__gmail__send_gmail_message","details":{"to":"s@x.com"}}]\n```')
    )
    const done = await run('Answer Sarah')
    expect(done.needsApproval).toBe(true)
    expect(h.spawns).toHaveLength(1)
    const last = saved.at(-1)
    expect(last?.text).toBe('Drafted a reply.')
    expect(last?.actions?.map((a) => [a.tool, a.status])).toEqual([[SEND, 'pending']])
  })
})

describe('approved actions', () => {
  it('runs only the approved tool, with no built-in tools and no saved session', async () => {
    const { engine } = setup()
    const a = action()
    h.events.push(...reply('✓ Sent reply to Sarah', [{ id: 't1', name: SEND, ok: true }]))
    await engine.executeAction('email-agent', { id: 'm1', agentId: 'email-agent', role: 'agent', text: '', createdAt: 0, actions: [a] }, a)

    const s = h.spawns[0]
    expect(flag(s, '--allowedTools')).toBe(SEND)
    expect(flag(s, '--tools')).toBe('')
    expect(flag(s, '--disallowedTools')).toBe('mcp__gmail__manage_gmail_filter')
    expect(s?.args).toContain('--no-session-persistence')
    expect(s?.input).toContain('"to": "sarah@example.com"')
    expect(a.status).toBe('done')
    expect(a.result).toBe('✓ Sent reply to Sarah')
  })

  it("refuses a tool from a server the agent isn't connected to", async () => {
    const { engine, notes } = setup()
    const a = action({ tool: 'mcp__slack__post_message' })
    await engine.executeAction('email-agent', { id: 'm1', agentId: 'email-agent', role: 'agent', text: '', createdAt: 0 }, a)
    expect(h.spawns).toHaveLength(0)
    expect(a.status).toBe('failed')
    expect(notes.at(-1)).toMatch(/could not be carried out/)
  })

  it('refuses built-in tools and actions that name no tool', async () => {
    const { engine } = setup()
    for (const tool of ['Bash', undefined]) {
      const a = action({ tool })
      await engine.executeAction('email-agent', { id: 'm1', agentId: 'email-agent', role: 'agent', text: '', createdAt: 0 }, a)
      expect(a.status).toBe('failed')
    }
    expect(h.spawns).toHaveLength(0)
  })

  it("fails if the run never actually called the tool", async () => {
    const { engine } = setup()
    const a = action()
    h.events.push(...reply('✓ Sent reply to Sarah'))
    await engine.executeAction('email-agent', { id: 'm1', agentId: 'email-agent', role: 'agent', text: '', createdAt: 0 }, a)
    expect(a.status).toBe('failed')
    expect(a.result).toMatch(/never called/)
  })

  it('keeps both results when two actions on one message run at once', async () => {
    const { engine, saved } = setup()
    const a1 = action()
    const a2 = action({ id: 'act-2', summary: 'Reply to Tom' })
    const msg = (): ChatMessage => ({ id: 'm1', agentId: 'email-agent', role: 'agent', text: '', createdAt: 0, actions: [structuredClone(a1), structuredClone(a2)] })
    saved.push(msg())
    // Each approval loads its own copy of the message, like two quick clicks.
    const m1 = msg()
    const m2 = msg()
    h.events.push(...reply('✓ Sent', [{ id: 't1', name: SEND, ok: true }]))
    const first = engine.executeAction('email-agent', m1, m1.actions![0]!)
    h.events.push(...reply('✓ Sent', [{ id: 't2', name: SEND, ok: true }]))
    const second = engine.executeAction('email-agent', m2, m2.actions![1]!)
    await Promise.all([first, second])
    expect(saved.findLast((m) => m.id === 'm1')?.actions?.map((a) => a.status)).toEqual(['done', 'done'])
  })

  it('fails instead of staying on "Working…" when the run throws', async () => {
    const { engine, notes } = setup()
    const a = action()
    h.spawnError = 'EMFILE: too many open files'
    await engine.executeAction('email-agent', { id: 'm1', agentId: 'email-agent', role: 'agent', text: '', createdAt: 0 }, a)
    expect(a.status).toBe('failed')
    expect(a.result).toMatch(/EMFILE/)
    expect(notes.at(-1)).toMatch(/could not be carried out/)
  })
})

describe('handoffs', () => {
  const block = '```handoff\n[{"to":"planner","task":"Block out Friday afternoon for the Sarah deadline."}]\n```'

  it('turns a proposed handoff into a pending card without running anything', async () => {
    const { run, saved } = setup()
    h.events.push(...reply(`Sarah needs it Friday.\n\n${block}`))
    const done = await run('Check the inbox')
    expect(done.ok).toBe(true)
    expect(h.spawns).toHaveLength(1)
    const last = saved.at(-1)
    expect(done.handoffTo).toBe('Planner')
    expect(last?.text).toBe('Sarah needs it Friday.')
    expect(last?.handoffs).toMatchObject([{ toAgentId: 'planner', toName: 'Planner', task: 'Block out Friday afternoon for the Sarah deadline.', status: 'pending' }])
  })

  it('tells the agent about the other agents, but only in one-on-one chats', async () => {
    const { run } = setup()
    h.events.push(...reply('Hi'))
    await run('Hi')
    const prompt = h.spawns[0]?.args[h.spawns[0].args.indexOf('--append-system-prompt') + 1] ?? ''
    expect(prompt).toContain('```handoff')
    expect(prompt).toContain('- Planner: You plan my day.')
    expect(prompt).not.toContain('- Email Agent:') // not itself
  })

  it('ignores a handoff to an agent that does not exist and says so', async () => {
    const { run, saved } = setup()
    h.events.push(...reply('Done.\n\n```handoff\n[{"to":"Accountant","task":"File my taxes"}]\n```'))
    await run('Go')
    expect(saved.at(-2)?.handoffs).toBeUndefined()
    expect(saved.at(-1)).toMatchObject({ role: 'error' })
    expect(saved.at(-1)?.text).toContain('"Accountant"')
  })
})

describe('reminders', () => {
  const at = new Date(Date.now() + 3_600_000)
  const local = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}T${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`

  it('schedules a reminder from a reply and shows it on the message', async () => {
    const { run, saved, reminders, engine } = setup(helper)
    const changed = vi.fn()
    engine.on('remindersChanged', changed)
    h.events.push(...reply(`Will do.\n\n\`\`\`reminders\n[{"at":"${local}","message":"Gym time"}]\n\`\`\``))
    const done = await run('Remind me in an hour to go to the gym')
    expect(done.ok).toBe(true)
    const last = saved.at(-1)
    expect(last?.text).toBe('Will do.')
    expect(last?.reminders).toMatchObject([{ kind: 'message', text: 'Gym time', status: 'scheduled', messageId: last?.id }])
    expect(reminders).toHaveLength(1)
    expect(changed).toHaveBeenCalledOnce()
  })

  it('tells one-on-one chats how to set reminders', async () => {
    const { run } = setup()
    h.events.push(...reply('Hi'))
    await run('Hi')
    const prompt = h.spawns[0]?.args[h.spawns[0].args.indexOf('--append-system-prompt') + 1] ?? ''
    expect(prompt).toContain('```reminders')
    expect(prompt).toContain('Their name is Nathan.\nStudent in Galway.')
  })

  it('labels a reminder run in the prompt', async () => {
    const { engine } = setup(helper)
    h.events.push(...reply('Sarah replied.'))
    await new Promise((resolve) => {
      engine.once('runFinished', resolve)
      engine.enqueue(helper.id, { source: 'reminder', prompt: 'Check for Sarah', attachments: [], dueAt: Date.now() })
    })
    expect(h.spawns[0]?.input).toMatch(/A reminder you set earlier is due now\. Do the task below/)
    expect(h.spawns[0]?.input).toContain('Check for Sarah')
  })
})

describe('quiet routine runs', () => {
  const runAs = (engine: ReturnType<typeof setup>['engine'], source: 'chat' | 'routine'): Promise<RunFinished> =>
    new Promise((resolve) => {
      engine.once('runFinished', resolve)
      engine.enqueue(emailAgent.id, { source, prompt: 'Sweep', attachments: [] })
    })

  it('lets a routine with nothing to report skip the notification', async () => {
    const { engine, saved } = setup()
    h.events.push(...reply('[quiet]\nNothing new since this morning.'))
    const done = await runAs(engine, 'routine')
    expect(h.spawns[0]?.input).toContain('start your reply with the line [quiet]')
    expect(done.quiet).toBe(true)
    expect(saved.at(-1)?.text).toBe('Nothing new since this morning.')
  })

  it('never treats a chat reply as quiet, nor tells chats about it', async () => {
    const { engine, saved } = setup()
    h.events.push(...reply('[quiet] hi'))
    const done = await runAs(engine, 'chat')
    expect(h.spawns[0]?.input).not.toContain('[quiet]')
    expect(done.quiet).toBe(false)
    expect(saved.at(-1)?.text).toBe('[quiet] hi')
  })
})

describe('lasting notes', () => {
  it('shows them at the start of a fresh session only', async () => {
    const fresh = setup()
    h.events.push(...reply('Hi'))
    await fresh.run('Hi')
    expect(h.spawns[0]?.input).toContain('- Prefers short replies')

    const resumed = setup({ ...emailAgent, session_id: 'sess-1' })
    h.events.push(...reply('Hi again'))
    await resumed.run('Hi again')
    expect(h.spawns[1]?.input).not.toContain('Prefers short replies')
  })
})

describe('saving usage', () => {
  it('runs routines on Haiku in a throwaway session that starts from notes and the last reply', async () => {
    const { engine, notes } = setup({ ...emailAgent, session_id: 'chat-sess' })
    h.events.push(...reply('[quiet] Nothing new.'))
    await new Promise((resolve) => {
      engine.once('runFinished', resolve)
      engine.enqueue(emailAgent.id, { source: 'routine', prompt: 'Sweep', attachments: [] })
    })
    const s = h.spawns[0]
    expect(s?.args).toContain('--no-session-persistence')
    expect(s?.args).not.toContain('--resume')
    expect(flag(s, '--model')).toBe('claude-haiku-4-5-20251001')
    expect(flag(s, '--effort')).toBe('low')
    expect(s?.input).toContain('Earlier: 3 emails, none urgent.')
    expect(s?.input).toContain('Prefers short replies')
    expect(notes.at(-1)).toMatch(/^Your scheduled routine reported: Nothing new\./)
  })

  it('starts a long chat session over, carrying the last messages across', async () => {
    const setSession = vi.fn()
    const { engine, notes, saved } = setup({ ...emailAgent, session_id: 'chat-sess' })
    ;(engine as unknown as { deps: { store: { setSession: unknown } } }).deps.store.setSession = setSession
    const big = reply('Done.')
    big.splice(1, 0, { type: 'assistant', message: { usage: { input_tokens: 10, cache_read_input_tokens: 70_000 }, content: [] } })
    h.events.push(...big)
    await new Promise((resolve) => {
      engine.once('runFinished', resolve)
      engine.enqueue(emailAgent.id, { source: 'chat', prompt: 'Hi', attachments: [] })
    })
    expect(setSession).toHaveBeenLastCalledWith('email-agent', null)
    expect(notes.at(-1)).toContain('User: Plan my week')
    expect(saved.at(-1)?.text).toMatch(/fresh session/)
  })
})

describe('read-only folders', () => {
  it('adds the folder and denies writes inside it', async () => {
    const dir = tmpdir()
    const { run } = setup({ ...helper, read_folders: [dir, '/does/not/exist'] })
    h.events.push(...reply('Read it.'))
    await run('What does my plan say?')
    const s = h.spawns[0]
    expect(s?.args.filter((a, i) => s.args[i - 1] === '--add-dir')).toEqual([dir])
    expect(flag(s, '--disallowedTools')?.split(',')).toEqual(expect.arrayContaining([`Edit(/${dir}/**)`, `Write(/${dir}/**)`]))
    const prompt = s?.args[s.args.indexOf('--append-system-prompt') + 1] ?? ''
    expect(prompt).toContain(`folder ${dir}`)
    expect(prompt).not.toContain('/does/not/exist')
  })
})
