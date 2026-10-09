// Carrying out an approved action is a short claude run told to call one tool "exactly as
// approved". The model could still pass different inputs (another recipient, a reworded
// body) or call the tool twice, so a PreToolUse hook (resources/approval-guard.cjs) checks
// the call against the approved details before it runs, and lets through only one.
import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { TMP_DIR } from './paths'

/** The hook script: outside the asar archive in the packaged app (see asarUnpack). */
function scriptPath(): string {
  return join(__dirname, '../../resources/approval-guard.cjs').replace(`app.asar${'/'}`, 'app.asar.unpacked/')
}

const quote = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`

export interface ApprovalGuard {
  /** For `--settings`: the hook, on this tool only (a catch-all would also block ToolSearch). */
  settings: string
  /** Why the hook blocked the call, if it did. */
  denied(): string | null
  cleanup(): void
}

export function approvalGuard(tool: string, details: Record<string, unknown> | undefined, dir = TMP_DIR): ApprovalGuard {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const file = join(dir, `approved-${randomUUID()}.json`)
  writeFileSync(file, JSON.stringify({ tool, details: details ?? {} }), { mode: 0o600 })
  const command = `ELECTRON_RUN_AS_NODE=1 ${quote(process.execPath)} ${quote(scriptPath())} ${quote(file)}`
  return {
    settings: JSON.stringify({ hooks: { PreToolUse: [{ matcher: tool, hooks: [{ type: 'command', command, timeout: 30 }] }] } }),
    denied: () => {
      try {
        return readFileSync(`${file}.denied`, 'utf8').trim() || null
      } catch {
        return null
      }
    },
    cleanup: () => {
      for (const f of [file, `${file}.used`, `${file}.denied`]) rmSync(f, { force: true })
    }
  }
}
