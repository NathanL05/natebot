// Daily backups of ~/NateBot: a consistent copy of data.db (chats, reminders, jobs…),
// the agent YAML files, settings and every agent's lasting notes, in
// ~/NateBot/backups/<date>/. The last 7 are kept. mcp.json is left out on purpose:
// it can hold OAuth secrets, and Connect Gmail rewrites it anyway.
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { AGENTS_DIR, ROOT, SETTINGS_FILE, WORKSPACES_DIR } from './paths'

export const BACKUPS_DIR = join(ROOT, 'backups')
const KEEP = 7

/** The local date (a UTC date would name the backup after the wrong day around midnight). */
export const today = (d = new Date()): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** Makes today's backup if there isn't one yet. Returns its folder, or null if it already existed. */
export function backupIfDue(db: DatabaseSync, dir = BACKUPS_DIR): string | null {
  const target = join(dir, today())
  if (existsSync(target)) return null
  mkdirSync(target, { recursive: true, mode: 0o700 })
  // VACUUM INTO writes a consistent copy even while the app is using the database.
  db.exec(`VACUUM INTO '${join(target, 'data.db').replace(/'/g, "''")}'`)
  if (existsSync(AGENTS_DIR)) cpSync(AGENTS_DIR, join(target, 'agents'), { recursive: true })
  if (existsSync(SETTINGS_FILE)) cpSync(SETTINGS_FILE, join(target, 'settings.json'))
  if (existsSync(WORKSPACES_DIR)) {
    for (const agent of readdirSync(WORKSPACES_DIR)) {
      const notes = join(WORKSPACES_DIR, agent, 'memory.md')
      if (existsSync(notes)) cpSync(notes, join(target, 'notes', `${agent}.md`))
    }
  }
  prune(dir)
  return target
}

/** Keeps the newest KEEP dated backups. */
export function prune(dir: string, keep = KEEP): void {
  const dated = readdirSync(dir).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort()
  for (const old of dated.slice(0, Math.max(0, dated.length - keep))) rmSync(join(dir, old), { recursive: true, force: true })
}
