// "Connect Apple Reminders & Notes": adds the bundled connector (resources/apple-mcp.cjs)
// to mcp.json, run by NateBot's own executable in Node mode, and asks macOS for
// permission to control Reminders and Notes while you're there to click Allow.
import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { loadServers, saveServer, type ServerEntry } from './mcp'

export const APPLE_SERVER = 'apple'
export const APPLE_APPROVAL_TOOLS = ['create_reminder', 'complete_reminder', 'create_note']

/** The connector script: outside the asar archive in the packaged app (see asarUnpack). */
function scriptPath(): string {
  return join(__dirname, '../../resources/apple-mcp.cjs').replace(`app.asar${'/'}`, 'app.asar.unpacked/')
}

export function appleEntry(): ServerEntry {
  return {
    command: process.execPath,
    args: [scriptPath()],
    env: { ELECTRON_RUN_AS_NODE: '1' },
    description: 'Apple Reminders & Notes on this Mac (sync to your iPhone). Creating or completing needs your approval.',
    agent_notes:
      'Apple Reminders and Notes on this Mac, synced to the user\'s iPhone through iCloud. Read freely with list_reminder_lists, list_reminders, search_notes and read_note. ' +
      'create_reminder, complete_reminder and create_note need approval: propose them. Reminder due times are local, like 2026-10-05T09:00.',
    require_approval: APPLE_APPROVAL_TOOLS,
    natebot_managed: true
  }
}

/** Keeps a connected entry pointing at this copy of NateBot (it moves between dev and the installed app). */
export function refreshAppleEntry(): void {
  const current = loadServers()[APPLE_SERVER]
  if (!current || current['natebot_managed'] !== true) return
  const next = appleEntry()
  if (current['command'] !== next['command'] || JSON.stringify(current['args']) !== JSON.stringify(next['args'])) saveServer(APPLE_SERVER, next)
}

export function appleConnected(): boolean {
  return !!loadServers()[APPLE_SERVER]
}

/** One harmless read from each app, which makes macOS ask for permission now. */
function probe(appName: 'Reminders' | 'Notes'): Promise<string | null> {
  const script = appName === 'Reminders' ? "Application('Reminders').lists().length" : "Application('Notes').folders().length"
  return new Promise((resolve) => {
    execFile('/usr/bin/osascript', ['-l', 'JavaScript', '-e', script], { timeout: 120_000 }, (err, _out, stderr) => {
      if (!err) return resolve(null)
      const msg = String(stderr || err.message)
      resolve(/-1743|not authori[sz]ed|not allowed/i.test(msg) ? `NateBot isn't allowed to control ${appName}. Allow it in System Settings → Privacy & Security → Automation.` : msg.trim().slice(0, 300))
    })
  })
}

export async function connectApple(): Promise<{ ok: boolean; error?: string }> {
  if (process.platform !== 'darwin') return { ok: false, error: 'Apple Reminders and Notes need macOS.' }
  for (const name of ['Reminders', 'Notes'] as const) {
    const error = await probe(name)
    if (error) return { ok: false, error }
  }
  saveServer(APPLE_SERVER, appleEntry())
  return { ok: true }
}
