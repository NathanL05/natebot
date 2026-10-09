// Leftovers in NateBot's temp folder. Per-run MCP configs are deleted after each run,
// but a crash or force-quit leaves them behind, and they can hold OAuth secrets (the
// approved-action files the approval guard reads hold an email's text).
// Clipboard screenshots from quick capture are copied into the agent's workspace
// when sent, so the temp copy is only needed for a little while.
import { readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'

const CLIPBOARD_KEEP_MS = 24 * 60 * 60_000

/**
 * Deletes every per-run MCP config and approved-action check (call only when no run can be in progress, i.e. at
 * startup) and clipboard images older than a day. Returns how many files were removed.
 */
export function cleanTmp(dir: string, now = Date.now()): number {
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch {
    return 0
  }
  let removed = 0
  for (const name of names) {
    const file = join(dir, name)
    try {
      const stale = /^mcp-.+\.json$/.test(name) || /^approved-[\w-]+\.json(\.used|\.denied)?$/.test(name) || (/^clipboard-\d+\.png$/.test(name) && now - statSync(file).mtimeMs > CLIPBOARD_KEEP_MS)
      if (!stale) continue
      rmSync(file, { force: true })
      removed++
    } catch {
      // Gone already, or not ours to remove.
    }
  }
  return removed
}
