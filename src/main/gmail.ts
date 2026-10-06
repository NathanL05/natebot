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
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs'
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
export const TASKS_CREDENTIALS_DIR = join(ROOT, 'credentials', 'google-tasks')
export const DRIVE_CREDENTIALS_DIR = join(ROOT, 'credentials', 'google-drive')
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

/** Task changes (create, update, complete, delete) only through Approve. */
export const TASKS_APPROVAL_TOOLS = ['manage_task', 'manage_task_list']

/** Drive and Docs tools that create or change files: only through Approve. Reading is free. */
export const DRIVE_APPROVAL_TOOLS = [
  'create_drive_file',
  'create_drive_folder',
  'import_to_google_doc',
  'import_to_google_slides',
  'import_to_google_sheets',
  'create_doc',
  'modify_doc_text'
]

export type GoogleServer = 'gmail' | 'gcal' | 'gtasks' | 'gdrive'

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
  },
  gtasks: {
    server: 'gtasks',
    label: 'Google Tasks',
    credentialsDir: TASKS_CREDENTIALS_DIR,
    probe: (email) => ({ name: 'list_task_lists', arguments: { user_google_email: email, max_results: 1 } })
  },
  gdrive: {
    server: 'gdrive',
    label: 'Google Drive',
    credentialsDir: DRIVE_CREDENTIALS_DIR,
    probe: (email) => ({ name: 'search_drive_files', arguments: { user_google_email: email, query: 'trashed = false', page_size: 1 } })
  }
}

export const isGoogle = (server: string): server is GoogleServer => server in SERVICES

/** "Gmail", "Google Calendar"… for messages. */
export const googleLabel = (server: string): string => (isGoogle(server) ? SERVICES[server].label : server)

/** The extra Google services that borrow Gmail's address and OAuth client, each with its own sign-in. */
const EXTRA: Record<Exclude<GoogleServer, 'gmail'>, (email: string, clientId: string, clientSecret: string) => ServerEntry> = {
  gcal: (e, id, secret) => calendarEntry(e, id, secret),
  gtasks: (email, clientId, clientSecret) => ({
    command: 'uvx',
    args: [`workspace-mcp==${WORKSPACE_MCP_VERSION}`, '--single-user', '--tools', 'tasks', '--tool-tier', 'complete'],
    env: googleEnv(email, clientId, clientSecret, TASKS_CREDENTIALS_DIR),
    description: `Google Tasks (${email}): read your task lists. Changes need your approval.`,
    agent_notes:
      `The Google account is ${email}. Pass user_google_email="${email}" to Tasks tools. ` +
      'Read with list_task_lists, list_tasks and get_task. Adding, changing, completing or deleting a task uses manage_task and needs approval: propose it. ' +
      "If a Tasks tool says sign-in is needed, tell the user to click Connect Tasks in NateBot's Settings.",
    require_approval: TASKS_APPROVAL_TOOLS
  }),
  gdrive: (email, clientId, clientSecret) => ({
    command: 'uvx',
    args: [`workspace-mcp==${WORKSPACE_MCP_VERSION}`, '--single-user', '--tools', 'drive', 'docs', '--tool-tier', 'core'],
    env: googleEnv(email, clientId, clientSecret, DRIVE_CREDENTIALS_DIR),
    description: `Google Drive and Docs (${email}): search and read files. Creating or editing needs your approval.`,
    agent_notes:
      `The Google account is ${email}. Pass user_google_email="${email}" to Drive and Docs tools. ` +
      'Find files with search_drive_files and read them with get_drive_file_content or get_doc_content. Creating or editing files needs approval: propose it. ' +
      "If a Drive tool says sign-in is needed, tell the user to click Connect Drive in NateBot's Settings.",
    require_approval: DRIVE_APPROVAL_TOOLS
  })
}

function googleEnv(email: string, clientId: string, clientSecret: string, dir: string): Record<string, string> {
  return {
    GOOGLE_OAUTH_CLIENT_ID: clientId,
    GOOGLE_OAUTH_CLIENT_SECRET: clientSecret,
    USER_GOOGLE_EMAIL: email,
    OAUTHLIB_INSECURE_TRANSPORT: '1',
    WORKSPACE_MCP_CREDENTIALS_DIR: dir
  }
}

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

/**
 * Google refused to refresh this token file (invalid_grant): set it aside as <file>.expired so the
 * service shows as not connected (agents stop getting a broken server, Settings says Connect again).
 * The refresh token in it is dead, so nothing usable is lost.
 */
export function markSignInExpired(path: string): void {
  try {
    if (existsSync(path)) renameSync(path, `${path}.expired`)
    log(`google: sign-in expired (${path.split('/').slice(-2).join('/')})`)
  } catch (e) {
    log(`google: could not mark sign-in expired: ${(e as Error).message}`)
  }
}

function signInExpired(server: GoogleServer): boolean {
  const { email } = savedEntry(server)
  return !!email && !googleReady(server) && existsSync(`${tokenFile(email, SERVICES[server].credentialsDir)}.expired`)
}

/** A Google service's sign-in token file once it's connected (for NateBot's own API calls). */
export function googleTokenPath(server: string): string | null {
  if (!isGoogle(server)) return null
  const { email } = savedEntry(server)
  return email && googleReady(server) ? tokenFile(email, SERVICES[server].credentialsDir) : null
}

export function gmailTokenPath(): string | null {
  return googleTokenPath('gmail')
}

export function gmailReady(): boolean {
  return googleReady('gmail')
}

/** Calendar uses Gmail's address and OAuth client, so it can be connected once Gmail is set up. */
export function calendarStatus(): GmailStatus {
  return googleStatus('gcal')
}

/** Status of Calendar, Tasks or Drive, with Gmail's details (they share its address and client). */
export function googleStatus(server: string): GmailStatus {
  const gmail = savedEntry('gmail')
  const s = isGoogle(server) ? server : 'gcal'
  return {
    configured: !!savedEntry(s).email,
    connected: googleReady(s),
    email: gmail.email,
    clientId: gmail.clientId,
    hasSecret: !!gmail.clientSecret,
    uvInstalled: findOnPath('uvx') !== null,
    expired: signInExpired(s)
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
    uvInstalled: findOnPath('uvx') !== null,
    expired: signInExpired('gmail')
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
  for (const server of Object.keys(EXTRA) as (keyof typeof EXTRA)[]) {
    const other = savedEntry(server)
    if (res.ok && other.email && (other.email !== email || other.clientId !== clientId || other.clientSecret !== clientSecret)) {
      saveServer(server, EXTRA[server](email, clientId, clientSecret))
      log(`${server}: updated to match Gmail`)
    }
  }
  return res
}

/** Connects Calendar, Tasks or Drive with Gmail's address and OAuth client (each keeps its own sign-in). */
export async function connectGoogle(server: string, onProgress: (p: GmailProgress) => void): Promise<{ ok: boolean; error?: string }> {
  if (!isGoogle(server) || server === 'gmail') return { ok: false, error: 'Unknown Google service.' }
  const { email, clientId, clientSecret } = savedEntry('gmail')
  if (!email || !clientId || !clientSecret) {
    return { ok: false, error: `Connect Gmail first: ${SERVICES[server].label} uses the same Google address and OAuth client.` }
  }
  return signIn(SERVICES[server], EXTRA[server](email, clientId, clientSecret), email, onProgress)
}

export async function connectCalendar(onProgress: (p: GmailProgress) => void): Promise<{ ok: boolean; error?: string }> {
  return connectGoogle('gcal', onProgress)
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
    rmSync(`${token}.expired`, { force: true })
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
