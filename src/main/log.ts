// Tiny append-only log at ~/Library/Logs/NateBot/main.log for diagnosing
// problems in the packaged app. Never log prompts, replies or secrets.
import { app } from 'electron'
import { appendFileSync, mkdirSync, statSync, renameSync } from 'node:fs'
import { join } from 'node:path'

let file: string | null = null
/** Lines written since the size was last checked: NateBot can run for weeks in the menu bar. */
let sinceCheck = 0
const CHECK_EVERY = 200

export function log(message: string): void {
  try {
    if (!file) {
      const dir = app.getPath('logs')
      mkdirSync(dir, { recursive: true })
      file = join(dir, 'main.log')
      sinceCheck = CHECK_EVERY
    }
    if (sinceCheck++ >= CHECK_EVERY) {
      sinceCheck = 1
      // Keep it small: rotate at 1 MB.
      try {
        if (statSync(file).size > 1_000_000) renameSync(file, `${file}.1`)
      } catch {
        // no log yet
      }
    }
    appendFileSync(file, `${new Date().toISOString()} ${message}\n`)
  } catch {
    // Logging must never break the app.
  }
}
