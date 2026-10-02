// "Connect Gmail" and "Connect Calendar": write the server entry into
// ~/NateBot/mcp.json and run the one-time Google sign-in by talking to the
// MCP server directly. Calendar reuses Gmail's address and OAuth client but
// keeps its own token (its own credentials folder), so connecting it can
// never replace or break the Gmail sign-in.
//
// Server: taylorwilsdon/google_workspace_mcp ("workspace-mcp" on PyPI), run
// with uvx in single-user stdio mode. On the first Gmail call it opens the
// browser for Google sign-in and receives the redirect on localhost:8000 —
// but only while that same server process is alive. So the sign-in must
// happen here (where we keep the process running until the token lands),
// never inside a short-lived agent run.
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { createInterface } from 'node:readline'
import { join } from 'node:path'
import type { GmailProgress, GmailStatus } from '@shared/types'
import { childEnv, findOnPath } from './env'
import { log } from './log'
import { loadServers, saveServer, type ServerEntry } from './mcp'
import { ROOT } from './paths'

export const WORKSPACE_MCP_VERSION = '1.29.0'
export const GMAIL_CREDENTIALS_DIR = join(ROOT, 'credentials', 'google')
export const CALENDAR_CREDENTIALS_DIR = join(ROOT, 'credentials', 'google-calendar')
/** workspace-mcp's stdio sign-in callback: http://localhost:8000/oauth2callback */
const CALLBACK_PORT = 8000
const SIGNIN_TIMEOUT = 5 * 60_000

/** Gmail tools that can only run through NateBot's Approve button. */
export const GMAIL_APPROVAL_TOOLS = [
  'send_gmail_message',
  'manage_gmail_filter',
  'manage_gmail_label',
  'modify_gmail_message_labels',
  'batch_modify_gmail_message_labels'
]

/** Calendar tools that change things (create/update/delete events, RSVP…): only through Approve. */
export const CALENDAR_APPROVAL_TOOLS = ['manage_event', 'create_calendar', 'manage_out_of_office', 'manage_focus_time']

type GoogleServer = 'gmail' | 'gcal'

interface GoogleService {
  server: GoogleServer
  label: string
  credentialsDir: string
  /** A harmless read that needs this service's sign-in. */
  probe: (email: string) => { name: string; arguments: Record<string, unknown> }
}

const SERVICES: Record<GoogleServer, GoogleService> = {
  gmail: {
    server: 'gmail',
    label: 'Gmail',
    credentialsDir: GMAIL_CREDENTIALS_DIR,
    probe: (email) => ({ name: 'search_gmail_messages', arguments: { query: 'in:inbox', user_google_email: email, page_size: 1 } })
  },
  gcal: {
    server: 'gcal',
    label: 'Google Calendar',
    credentialsDir: CALENDAR_CREDENTIALS_DIR,
    probe: (email) => ({ name: 'list_calendars', arguments: { user_google_email: email } })
  }
}

const isGoogle = (server: string): server is GoogleServer => server === 'gmail' || server === 'gcal'

export function calendarEntry(email: string, clientId: string, clientSecret: string): ServerEntry {
  return {
    command: 'uvx',
    args: [`workspace-mcp==${WORKSPACE_MCP_VERSION}`, '--single-user', '--tools', 'calendar', '--tool-tier', 'extended'],
    env: {
      GOOGLE_OAUTH_CLIENT_ID: clientId,
      GOOGLE_OAUTH_CLIENT_SECRET: clientSecret,
      USER_GOOGLE_EMAIL: email,
      OAUTHLIB_INSECURE_TRANSPORT: '1',
      WORKSPACE_MCP_CREDENTIALS_DIR: CALENDAR_CREDENTIALS_DIR
    },
    description: `Google Calendar (${email}): read events and free time. Changes need your approval.`,
    agent_notes:
      `The Google Calendar account is ${email}. Pass user_google_email="${email}" to Calendar tools. ` +
      'Read with get_events, list_calendars and query_freebusy. Creating, changing, deleting or answering events uses manage_event and always needs approval: propose it. ' +
      "If a Calendar tool says sign-in or authorization is needed, don't share any link: tell the user to click Connect Calendar in NateBot's Settings.",
    require_approval: CALENDAR_APPROVAL_TOOLS
  }
}

export function gmailEntry(email: string, clientId: string, clientSecret: string): ServerEntry {
  return {
    command: 'uvx',
    args: [`workspace-mcp==${WORKSPACE_MCP_VERSION}`, '--single-user', '--tools', 'gmail', '--tool-tier', 'extended'],
    env: {
      GOOGLE_OAUTH_CLIENT_ID: clientId,
      GOOGLE_OAUTH_CLIENT_SECRET: clientSecret,
      USER_GOOGLE_EMAIL: email,
      OAUTHLIB_INSECURE_TRANSPORT: '1',
      WORKSPACE_MCP_CREDENTIALS_DIR: GMAIL_CREDENTIALS_DIR
    },
    description: `Gmail (${email}): read, search, draft. Sending needs your approval.`,
    agent_notes:
      `The Gmail account is ${email}. Pass user_google_email="${email}" to Gmail tools. ` +
      'Create drafts with draft_gmail_message; sending uses send_gmail_message and always needs approval. ' +
      "If a Gmail tool says sign-in or authorization is needed, don't share any link: tell the user to click Connect Gmail in NateBot's Settings.",
    require_approval: GMAIL_APPROVAL_TOOLS
  }
}

/** The token file workspace-mcp writes: the email, URL-encoded except @ . _ - (Python quote(safe="@._-")). */
function tokenFile(email: string, dir: string): string {
  const safe = [...email]
    .map((ch) =>
      /[A-Za-z0-9@._~-]/.test(ch)
        ? ch
        : [...new TextEncoder().encode(ch)].map((b) => `%${b.toString(16).toUpperCase().padStart(2, '0')}`).join('')
    )
    .join('')
  return join(dir, `${safe}.json`)
}

function savedEntry(server: GoogleServer = 'gmail'): { email: string | null; clientId: string | null; clientSecret: string | null } {
  const env = (loadServers()[server]?.['env'] ?? {}) as Record<string, unknown>
  const str = (k: string): string | null => (typeof env[k] === 'string' && env[k] ? (env[k] as string) : null)
  return { email: str('USER_GOOGLE_EMAIL'), clientId: str('GOOGLE_OAUTH_CLIENT_ID'), clientSecret: str('GOOGLE_OAUTH_CLIENT_SECRET') }
}

/**
 * Whether agents can use a server: Gmail and Calendar only once they're configured
 * AND signed in (a short agent run can't finish a Google sign-in). Others always.
 */
export function googleReady(server: string): boolean {
  if (!isGoogle(server)) return true
  const { email, clientId } = savedEntry(server)
  if (!email) return false
  const file = tokenFile(email, SERVICES[server].credentialsDir)
  if (!existsSync(file)) return false
  // A token made with a different OAuth client (e.g. before Gmail was reconnected with a new
  // one) can't be refreshed with the current one: count it as not connected.
  try {
    const saved = (JSON.parse(readFileSync(file, 'utf8')) as { client_id?: unknown }).client_id
    return typeof saved !== 'string' || !clientId || saved === clientId
  } catch {
    return true
  }
}

export function gmailReady(): boolean {
  return googleReady('gmail')
}

/** Calendar uses Gmail's address and OAuth client, so it can be connected once Gmail is set up. */
export function calendarStatus(): GmailStatus {
  const gmail = savedEntry('gmail')
  return {
    configured: !!savedEntry('gcal').email,
    connected: googleReady('gcal'),
    email: gmail.email,
    clientId: gmail.clientId,
    hasSecret: !!gmail.clientSecret,
    uvInstalled: findOnPath('uvx') !== null
  }
}

export function gmailStatus(): GmailStatus {
  const saved = savedEntry()
  return {
    configured: !!saved.email,
    connected: gmailReady(),
    email: saved.email,
    clientId: saved.clientId,
    hasSecret: !!saved.clientSecret,
    uvInstalled: findOnPath('uvx') !== null
  }
}

function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = createServer()
    srv.once('error', () => resolve(false))
    srv.once('listening', () => srv.close(() => resolve(true)))
    srv.listen(port, '127.0.0.1')
  })
}

const AUTH_NEEDED = /ACTION REQUIRED|Authorization URL|authenticat|sign-in needed|start_google_auth/i

/** Minimal MCP JSON-RPC client over stdio. */
function rpcClient(child: ChildProcessWithoutNullStreams) {
  let nextId = 1
  const pending = new Map<number, (msg: Record<string, unknown>) => void>()
  createInterface({ input: child.stdout }).on('line', (line) => {
    try {
      const msg = JSON.parse(line) as Record<string, unknown>
      const id = msg['id']
      if (typeof id === 'number' && pending.has(id)) {
        pending.get(id)?.(msg)
        pending.delete(id)
      }
    } catch {
      // ignore non-protocol output
    }
  })
  const request = (method: string, params: unknown, timeoutMs: number): Promise<Record<string, unknown>> =>
    new Promise((resolve, reject) => {
      const id = nextId++
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error(`${method} timed out`))
      }, timeoutMs)
      pending.set(id, (msg) => {
        clearTimeout(timer)
        resolve(msg)
      })
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
    })
  const notify = (method: string): void => {
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method }) + '\n')
  }
  return { request, notify }
}

function resultText(msg: Record<string, unknown>): { text: string; isError: boolean } {
  if (msg['error']) return { text: JSON.stringify(msg['error']), isError: true }
  const result = (msg['result'] ?? {}) as { content?: { type: string; text?: string }[]; isError?: boolean }
  const text = (result.content ?? []).map((c) => c.text ?? '').join('\n')
  return { text, isError: result.isError === true }
}

/** The connector process of an in-progress sign-in, so quitting NateBot can stop it. */
let activeConnector: ChildProcessWithoutNullStreams | null = null

function killConnector(child: ChildProcessWithoutNullStreams): void {
  try {
    // uvx starts Python as a child: stop the whole process group.
    if (child.pid) process.kill(-child.pid, 'SIGTERM')
  } catch {
    child.kill('SIGTERM')
  }
}

export function stopGmailConnect(): void {
  if (activeConnector) killConnector(activeConnector)
  activeConnector = null
}

export async function connectGmail(
  input: { email: string; clientId: string; clientSecret: string },
  onProgress: (p: GmailProgress) => void
): Promise<{ ok: boolean; error?: string }> {
  const email = input.email.trim()
  const clientId = input.clientId.trim()
  // Reconnecting with the same client can leave the secret blank to reuse the saved one.
  const saved = savedEntry()
  const clientSecret = input.clientSecret.trim() || (saved.clientId === clientId ? (saved.clientSecret ?? '') : '')

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: 'Enter your Gmail address.' }
  if (!clientId.endsWith('.apps.googleusercontent.com')) {
    return { ok: false, error: 'The client ID should end in .apps.googleusercontent.com.' }
  }
  if (!clientSecret) return { ok: false, error: 'Paste the client secret too.' }

  const res = await signIn(SERVICES.gmail, gmailEntry(email, clientId, clientSecret), email, onProgress)
  // Calendar borrows Gmail's address and OAuth client: keep it in step. With a new address its
  // token no longer matches, and with a new client the old token is ignored, so it asks to reconnect.
  const cal = savedEntry('gcal')
  if (res.ok && cal.email && (cal.email !== email || cal.clientId !== clientId || cal.clientSecret !== clientSecret)) {
    saveServer('gcal', calendarEntry(email, clientId, clientSecret))
    log('gcal: updated to match Gmail')
  }
  return res
}

export async function connectCalendar(onProgress: (p: GmailProgress) => void): Promise<{ ok: boolean; error?: string }> {
  const { email, clientId, clientSecret } = savedEntry('gmail')
  if (!email || !clientId || !clientSecret) {
    return { ok: false, error: 'Connect Gmail first: Calendar uses the same Google address and OAuth client.' }
  }
  return signIn(SERVICES.gcal, calendarEntry(email, clientId, clientSecret), email, onProgress)
}

/** Saves the entry, starts the connector, and keeps it alive through Google sign-in until a probe call works. */
async function signIn(
  service: GoogleService,
  entry: ServerEntry,
  email: string,
  onProgress: (p: GmailProgress) => void
): Promise<{ ok: boolean; error?: string }> {
  const { label, server } = service
  const uvx = findOnPath('uvx')
  if (!uvx) {
    return { ok: false, error: 'uv is not installed. In Terminal run: brew install uv  (or see the README), then try again.' }
  }
  if (!(await portFree(CALLBACK_PORT))) {
    log(`${server}: port ${CALLBACK_PORT} busy`)
    return {
      ok: false,
      error: `Something else on this Mac is using port ${CALLBACK_PORT}, which Google sign-in needs. Quit it (or restart the Mac) and try again.`
    }
  }
  mkdirSync(service.credentialsDir, { recursive: true, mode: 0o700 })
  saveServer(server, entry)
  log(`${server}: connect started`)

  stopGmailConnect()
  onProgress({ stage: 'starting', message: `Starting the ${label} connector (the first time downloads it, ~1 min)…` })
  const child = spawn(uvx, entry['args'] as string[], {
    env: { ...childEnv(), ...(entry['env'] as Record<string, string>) },
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: true
  })
  activeConnector = child
  let stderr = ''
  child.stderr.on('data', (d: Buffer) => {
    stderr = (stderr + d.toString()).slice(-4000)
  })
  const exited = new Promise<never>((_, reject) =>
    child.on('close', (code) =>
      reject(new Error(`The ${label} connector stopped (code ${code}): ${stderr.trim().split('\n').slice(-2).join(' ')}`))
    )
  )
  exited.catch(() => undefined)
  const rpc = rpcClient(child)
  const probe = service.probe(email)
  const token = tokenFile(email, service.credentialsDir)

  try {
    await Promise.race([
      rpc.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'NateBot', version: '1' } }, 300_000),
      exited
    ])
    rpc.notify('notifications/initialized')
    log(`${server}: connector started`)

    onProgress({ stage: 'verifying', message: `Checking access to ${label}…` })
    let res = resultText(await Promise.race([rpc.request('tools/call', probe, 120_000), exited]))

    if (res.isError || AUTH_NEEDED.test(res.text)) {
      const url = /(https:\/\/accounts\.google\.com\/[^\s)"'>]+)/.exec(res.text)?.[1]
      log(`${server}: waiting for Google sign-in (auth url ${url ? 'received' : 'missing'})`)
      onProgress({ stage: 'signin', message: 'Finish signing in with Google in your browser. Keep NateBot open until this says Connected.', url })

      // Keep the connector (and its localhost:8000 callback) alive until
      // Google redirects back and it writes the token for this address.
      const deadline = Date.now() + SIGNIN_TIMEOUT
      while (!existsSync(token)) {
        if (Date.now() > deadline) throw new Error('Timed out waiting for Google sign-in (5 minutes). Click Connect to try again.')
        if (child.exitCode !== null || child.signalCode !== null) throw new Error(`The ${label} connector stopped before sign-in finished.`)
        await new Promise((r) => setTimeout(r, 1000))
      }
      log(`${server}: token received`)
      onProgress({ stage: 'verifying', message: `Signed in. Checking access to ${label}…` })
      res = resultText(await Promise.race([rpc.request('tools/call', probe, 120_000), exited]))
    }

    if (res.isError || AUTH_NEEDED.test(res.text)) {
      throw new Error(res.text.split('\n').slice(0, 3).join(' ').slice(0, 300) || `${label} did not respond as expected.`)
    }
    log(`${server}: connected`)
    onProgress({ stage: 'done', message: `${label} connected (${email}).` })
    return { ok: true }
  } catch (e) {
    const error = (e as Error).message
    log(`${server}: failed: ${error.slice(0, 200)}`)
    onProgress({ stage: 'error', message: error })
    return { ok: false, error }
  } finally {
    killConnector(child)
    if (activeConnector === child) activeConnector = null
  }
}
