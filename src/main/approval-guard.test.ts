// The hook that checks an approved action's tool call before it runs (resources/approval-guard.cjs).
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { approvalGuard } from './approval-guard'

const guard = createRequire(import.meta.url)('../../resources/approval-guard.cjs') as {
  norm: (v: unknown) => string
  mismatch: (approved: unknown, input: unknown) => string | null
  main: (file: string, stdin: string) => number
}

const SEND = 'mcp__gmail__send_gmail_message'
const approved = { to: 'sarah@example.com', subject: 'Re: Deadline', body: 'Hi Sarah,\n\nFriday works.\n\nNathan' }

describe('mismatch', () => {
  it('accepts the approved values, give or take case and spacing, plus inputs the details leave out', () => {
    const input = { user_google_email: 'me@gmail.com', to: 'Sarah@Example.com', subject: 'Re: Deadline', body: 'Hi Sarah,\r\n\r\nFriday works.\r\n\r\nNathan ' }
    expect(guard.mismatch(approved, input)).toBeNull()
    expect(guard.mismatch({ to: 'a@x.com, b@x.com' }, { to: ['a@x.com', 'b@x.com'] })).toBeNull()
    expect(guard.mismatch({ count: 3 }, { count: '3' })).toBeNull()
    // The same moment written two ways (an approved calendar event, then the tool's format).
    const local = new Date(2026, 9, 9, 10, 0)
    const offset = -local.getTimezoneOffset()
    const zone = `${offset >= 0 ? '+' : '-'}${String(Math.floor(Math.abs(offset) / 60)).padStart(2, '0')}:${String(Math.abs(offset) % 60).padStart(2, '0')}`
    expect(guard.mismatch({ start: '2026-10-09T10:00' }, { start: `2026-10-09T10:00:00${zone}` })).toBeNull()
    expect(guard.mismatch({ start: '2026-10-09T10:00' }, { start: '2026-10-09T11:00' })).toBe('start')
  })

  it('names the first detail that differs, nested ones too', () => {
    expect(guard.mismatch(approved, { ...approved, to: 'someone@else.com' })).toBe('to')
    expect(guard.mismatch(approved, { ...approved, body: 'Hi Sarah, Friday works. Cheers, Nathan' })).toBe('body')
    expect(guard.mismatch({ event: { start: '2026-10-09T10:00' } }, { event: { start: '2026-10-09T11:00' } })).toBe('event.start')
  })

  it("skips details the tool doesn't take under that name", () => {
    expect(guard.mismatch({ reason: 'follow up', To: 'sarah@example.com' }, { to: 'sarah@example.com' })).toBeNull()
  })
})

describe('the hook', () => {
  const setup = (details: Record<string, unknown> = approved): string => {
    const file = join(mkdtempSync(join(tmpdir(), 'natebot-guard-')), 'approved.json')
    writeFileSync(file, JSON.stringify({ tool: SEND, details }))
    return file
  }
  const call = (input: Record<string, unknown>, tool = SEND): string => JSON.stringify({ tool_name: tool, tool_input: input })
  const quiet = (): void => void vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

  it('lets the approved call through exactly once', () => {
    quiet()
    const file = setup()
    expect(guard.main(file, call(approved))).toBe(0)
    expect(guard.main(file, call(approved))).toBe(2)
    expect(readFileSync(`${file}.denied`, 'utf8')).toMatch(/already carried out once/)
  })

  it('blocks a changed recipient, and says why', () => {
    quiet()
    const file = setup()
    expect(guard.main(file, call({ ...approved, to: 'someone@else.com' }))).toBe(2)
    expect(readFileSync(`${file}.denied`, 'utf8')).toBe(`"to" isn't what you approved.`)
    expect(existsSync(`${file}.used`)).toBe(false)
  })

  it('blocks another tool, and fails closed when it cannot check', () => {
    quiet()
    expect(guard.main(setup(), call(approved, 'mcp__gmail__manage_gmail_filter'))).toBe(2)
    expect(guard.main(setup(), 'not json')).toBe(2)
    expect(guard.main('/nonexistent/approved.json', call(approved))).toBe(2)
  })
})

describe('approvalGuard', () => {
  it('hooks only the approved tool, and reports and cleans up the hook files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'natebot-guard-'))
    const g = approvalGuard(SEND, approved, dir)
    const hook = JSON.parse(g.settings).hooks.PreToolUse[0]
    expect(hook.matcher).toBe(SEND)
    const file = /'([^']*approved-[^']*\.json)'$/.exec(hook.hooks[0].command)?.[1] as string
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ tool: SEND, details: approved })
    expect(g.denied()).toBeNull()
    writeFileSync(`${file}.denied`, 'nope')
    expect(g.denied()).toBe('nope')
    g.cleanup()
    expect(existsSync(file) || existsSync(`${file}.denied`)).toBe(false)
  })
})
