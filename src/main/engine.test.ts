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
  events: [] as Record<string, unknown>[]
}))

vi.mock('electron', () => ({ app: { getPath: () => '/tmp' }, shell: {} }))
vi.mock(import('./paths'), async (importOriginal) => ({
  ...(await importOriginal()),
  workspaceOf: (id: string) => join(tmpdir(), 'natebot-tests', id)
}))
vi.mock('./gmail', () => ({ gmailReady: () => true }))
vi.mock('./skills', () => ({ hasInstalledSkills: () => false, SKILLS_PLUGIN: '/skills' }))
vi.mock('./mcp', () => ({
  agentNotes: () => [],
  configuredServersFor: (a: AgentConfig) => a.mcp_servers,
  approvalOnlyTools: (a: AgentConfig) => (a.mcp_servers.includes('gmail') ? ['mcp__gmail__send_gmail_message'] : []),
  writeRunConfig: (a: AgentConfig) => ({ path: '/tmp/mcp.json', servers: a.mcp_servers, cleanup: () => undefined })
}))
vi.mock('./claude/process', () => ({
  spawnClaude: (opts: { args: string[]; env: NodeJS.ProcessEnv; input: string; onEvent: (e: Record<string, unknown>) => void }) => {
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
  routine: null,
  session_id: null
}

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
  const engine = new Engine({
    store: { get: () => agent, require: () => agent, setSession: vi.fn() } as unknown as AgentStore,
    db: {
      saveMessage: (m: ChatMessage) => saved.push(structuredClone(m)),
      startRun: vi.fn(),
      finishRun: vi.fn(),
      takeNotes: () => [],
      addNote: (_id: string, n: string) => notes.push(n),
      bumpUnread: vi.fn()
    } as unknown as Db,
    usage: { waitMs: () => 0, update: vi.fn(), markLimited: vi.fn() } as unknown as UsageTracker,
    claudePath: () => '/usr/local/bin/claude',
    emitMessage: vi.fn(),
    emitAgents: vi.fn()
  })
  const run = (prompt: string): Promise<RunFinished> =>
    new Promise((resolve) => {
      engine.once('runFinished', resolve)
      engine.enqueue(agent.id, { source: 'chat', prompt, attachments: [] })
    })
  return { engine, saved, notes, run }
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
})
