// ~/NateBot holds chats (email summaries among them), settings, agents' notes and attachments.
// It used to be created with the default 755, so any other account on the Mac could read it.
// Locking the folder itself is enough: nothing inside can be reached without passing through it.
import { chmodSync, mkdirSync, statSync } from 'node:fs'

/** Creates `dir` if needed and makes it readable by its owner only. Returns whether it had to be tightened. */
export function makePrivate(dir: string): boolean {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  if ((statSync(dir).mode & 0o077) === 0) return false
  chmodSync(dir, 0o700)
  return true
}
