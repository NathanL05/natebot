// Gmail and Calendar readiness: agents only get a Google server once it has its
// own sign-in token, and Calendar never shares (or overwrites) Gmail's token.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ root: '', servers: {} as Record<string, Record<string, unknown>> }))

vi.mock('./paths', () => ({ get ROOT() {
  return h.root
} }))
vi.mock('./mcp', () => ({ loadServers: () => h.servers, saveServer: vi.fn() }))
vi.mock('./env', () => ({ childEnv: () => ({}), findOnPath: () => '/usr/local/bin/uvx' }))
vi.mock('./log', () => ({ log: () => undefined }))

h.root = mkdtempSync(join(tmpdir(), 'natebot-google-'))
const { calendarEntry, connectCalendar, gmailEntry, googleReady, CALENDAR_APPROVAL_TOOLS } = await import('./gmail')

const EMAIL = 'me@example.com'
const token = (dir: string): void => {
  mkdirSync(join(h.root, 'credentials', dir), { recursive: true })
  writeFileSync(join(h.root, 'credentials', dir, `${EMAIL}.json`), '{}')
}

// The credentials folders are fixed when gmail.ts loads, so reset what's inside instead.
beforeEach(() => {
  rmSync(join(h.root, 'credentials'), { recursive: true, force: true })
  h.servers = {}
})

describe('googleReady', () => {
  it('treats servers that are not Google as always ready', () => {
    expect(googleReady('notion')).toBe(true)
  })

  it('needs both the entry and that service’s own token', () => {
    expect(googleReady('gmail')).toBe(false)
    h.servers = { gmail: { env: { USER_GOOGLE_EMAIL: EMAIL } }, gcal: { env: { USER_GOOGLE_EMAIL: EMAIL } } }
    token('google')
    expect(googleReady('gmail')).toBe(true)
    // Gmail's token doesn't count for Calendar.
    expect(googleReady('gcal')).toBe(false)
    token('google-calendar')
    expect(googleReady('gcal')).toBe(true)
  })
})

describe('calendarEntry', () => {
  const entry = calendarEntry(EMAIL, 'id.apps.googleusercontent.com', 'secret')
  const env = entry['env'] as Record<string, string>

  it('runs only the calendar tools, with its own credentials folder', () => {
    expect(entry['args']).toEqual(expect.arrayContaining(['--tools', 'calendar']))
    const gmailEnv = gmailEntry(EMAIL, 'id', 'secret')['env'] as Record<string, string>
    expect(env['WORKSPACE_MCP_CREDENTIALS_DIR']).not.toBe(gmailEnv['WORKSPACE_MCP_CREDENTIALS_DIR'])
  })

  it('puts every tool that changes the calendar behind Approve', () => {
    expect(entry['require_approval']).toEqual(CALENDAR_APPROVAL_TOOLS)
    expect(CALENDAR_APPROVAL_TOOLS).toContain('manage_event')
  })
})

describe('connectCalendar', () => {
  it('asks for Gmail first instead of starting a sign-in', async () => {
    const progress = vi.fn()
    expect(await connectCalendar(progress)).toEqual({ ok: false, error: expect.stringContaining('Connect Gmail first') })
    expect(progress).not.toHaveBeenCalled()
  })
})
