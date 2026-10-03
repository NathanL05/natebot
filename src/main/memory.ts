// Lasting notes: memory.md in each agent's workspace. The agent keeps it up to date
// itself (file edits are allowed there), and NateBot shows it to the agent at the
// start of every fresh session, so what it learned about the user survives
// "Reset memory" and lost sessions. The user can read and edit it in agent settings.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { workspaceOf } from './paths'

export const MEMORY_FILE = 'memory.md'
/** Shown to the agent up to this size; the rest stays in the file. */
const MAX_SHOWN = 8_000
const MAX_SAVED = 50_000

export const memoryPath = (agentId: string): string => join(workspaceOf(agentId), MEMORY_FILE)

export function readMemory(agentId: string): string {
  const file = memoryPath(agentId)
  try {
    return existsSync(file) ? readFileSync(file, 'utf8').trim() : ''
  } catch {
    return ''
  }
}

export function writeMemory(agentId: string, text: string): void {
  const body = text.trim().slice(0, MAX_SAVED)
  writeFileSync(memoryPath(agentId), body ? `${body}\n` : '')
}

/** What a fresh session is shown, or null when there are no notes yet. */
export function memoryBlock(agentId: string): string | null {
  const notes = readMemory(agentId)
  if (!notes) return null
  const shown = notes.length > MAX_SHOWN ? `${notes.slice(0, MAX_SHOWN)}\n…(cut short: read ${MEMORY_FILE} for the rest)` : notes
  return `[Your lasting notes from ${MEMORY_FILE}, written in earlier conversations]\n${shown}`
}
