// "Connect Gmail": writes the gmail entry into ~/NateBot/mcp.json and runs the
// one-time Google sign-in by talking to the Gmail MCP server directly.
//
// Server: taylorwilsdon/google_workspace_mcp ("workspace-mcp" on PyPI), run
// with uvx in single-user stdio mode. On the first Gmail call it opens the
// browser for Google sign-in and receives the redirect on localhost; the
// token is then saved under ~/NateBot/credentials/google and refreshed
// automatically on later runs.
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { join } from 'node:path'
import type { GmailProgress, GmailStatus } from '@shared/types'
import { childEnv, findOnPath } from './env'
import { loadServers, saveServer, type ServerEntry } from './mcp'
import { ROOT } from './paths'

export const WORKSPACE_MCP_VERSION = '1.29.0'
export const GMAIL_CREDENTIALS_DIR = join(ROOT, 'credentials', 'google')

/** Gmail tools that can only run through NateBot's Approve button. */
export const GMAIL_APPROVAL_TOOLS = [
  'send_gmail_message',
  'manage_gmail_filter',
  'manage_gmail_label',
  'modify_gmail_message_labels',
  'batch_modify_gmail_message_labels'
]


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
    agent_notes: `The Gmail account is ${email}. Pass user_google_email="${email}" to Gmail tools. Create drafts with draft_gmail_message; sending uses send_gmail_message and always needs approval.`,
    require_approval: GMAIL_APPROVAL_TOOLS
  }
}

function hasToken(): boolean {
  try {
    return readdirSync(GMAIL_CREDENTIALS_DIR).some((f) => f.endsWith('.json'))
  } catch {
    return false
  }
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

export async function connectGmail(
  input: { email: string; clientId: string; clientSecret: string },
  onProgress: (p: GmailProgress) => void,
  openUrl: (url: string) => void
): Promise<{ ok: boolean; error?: string }> {
  const email = input.email.trim()
  const clientId = input.clientId.trim()
  const clientSecret = input.clientSecret.trim()
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: 'Enter your Gmail address.' }
  if (!clientId.endsWith('.apps.googleusercontent.com')) {
    return { ok: false, error: 'The client ID should end in .apps.googleusercontent.com.' }
  }
  if (!clientSecret) return { ok: false, error: 'Paste the client secret too.' }
  const uvx = findOnPath('uvx')
  if (!uvx) {
    return { ok: false, error: 'uv is not installed. In Terminal run: brew install uv  (or see the README), then try again.' }
  }

  mkdirSync(GMAIL_CREDENTIALS_DIR, { recursive: true, mode: 0o700 })
  const entry = gmailEntry(email, clientId, clientSecret)
  saveServer('gmail', entry)

  onProgress({ stage: 'starting', message: 'Starting the Gmail connector (the first time downloads it, ~1 min)…' })
  const child = spawn(uvx, entry['args'] as string[], {
    env: { ...childEnv(), ...(entry['env'] as Record<string, string>) },
    stdio: ['pipe', 'pipe', 'pipe']
  })
  let stderr = ''
  child.stderr.on('data', (d: Buffer) => {
    stderr = (stderr + d.toString()).slice(-4000)
  })
  const exited = new Promise<void>((resolve) => child.on('close', () => resolve()))
  const rpc = rpcClient(child)
  const search = { name: 'search_gmail_messages', arguments: { query: 'in:inbox', user_google_email: email, page_size: 1 } }

  try {
    await Promise.race([
      rpc.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'NateBot', version: '1' } }, 180_000),
      exited.then(() => {
        throw new Error(`The Gmail connector stopped: ${stderr.trim().split('\n').slice(-3).join(' ')}`)
      })
    ])
    rpc.notify('notifications/initialized')

    onProgress({ stage: 'verifying', message: 'Checking access to Gmail…' })
    let res = resultText(await rpc.request('tools/call', search, 60_000))

    if (res.isError || AUTH_NEEDED.test(res.text)) {
      const url = /(https:\/\/accounts\.google\.com\/[^\s)"'>]+)/.exec(res.text)?.[1]
      onProgress({ stage: 'signin', message: 'Sign in with Google in your browser, then come back here.', url })
      // The server normally opens the browser itself; open it too if it didn't say so.
      if (url && !/opened automatically: true/i.test(stderr)) openUrl(url)

      // Wait for the token to be written by the server's localhost callback.
      const deadline = Date.now() + 5 * 60_000
      while (!hasToken()) {
        if (Date.now() > deadline) throw new Error('Timed out waiting for Google sign-in (5 minutes).')
        if (child.exitCode !== null) throw new Error('The Gmail connector stopped before sign-in finished.')
        await new Promise((r) => setTimeout(r, 1500))
      }
      onProgress({ stage: 'verifying', message: 'Signed in. Checking access to Gmail…' })
      res = resultText(await rpc.request('tools/call', search, 60_000))
    }

    if (res.isError || AUTH_NEEDED.test(res.text)) {
      throw new Error(res.text.split('\n').slice(0, 3).join(' ').slice(0, 300) || 'Gmail did not respond as expected.')
    }
    onProgress({ stage: 'done', message: `Connected to ${email}.` })
    return { ok: true }
  } catch (e) {
    const error = (e as Error).message
    onProgress({ stage: 'error', message: error })
    return { ok: false, error }
  } finally {
    child.kill('SIGTERM')
  }
}

export function gmailStatus(): GmailStatus {
  const entry = loadServers()['gmail']
  const env = (entry?.['env'] ?? {}) as Record<string, unknown>
  return {
    configured: !!entry,
    connected: !!entry && existsSync(GMAIL_CREDENTIALS_DIR) && hasToken(),
    email: typeof env['USER_GOOGLE_EMAIL'] === 'string' ? env['USER_GOOGLE_EMAIL'] : null,
    uvInstalled: findOnPath('uvx') !== null
  }
}
