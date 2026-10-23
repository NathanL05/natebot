// A map of a folder the agent can read: every note with its size, when it was last edited and
// what it's about, plus the README.md and CLAUDE.md at its top in full. NateBot builds it from
// the files themselves (no Claude run) and puts it in the system prompt, so an agent doesn't
// spend its first turns listing the folder and opening files only to find out what's in them.
// The prompt changes only when the files do, so it stays cached between messages.
import { closeSync, openSync, readdirSync, readFileSync, readSync, statSync } from 'node:fs'
import { extname, join, relative } from 'node:path'

const NOTE_TYPES = new Set(['.md', '.markdown', '.txt', '.yaml', '.yml', '.csv', '.toml', '.org'])
/** Copies, generated files and tooling, not notes. Dot folders (.git, .claude worktrees) are skipped too. */
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'out', 'vendor', 'venv', 'target', '__pycache__', 'fixtures', 'snapshots'])
const TOP_FILES = ['README.md', 'CLAUDE.md']
const MAX_DEPTH = 6
const MAX_FILES = 300
/** Stop walking a huge folder (a home folder, say) after this many entries. */
const MAX_VISITED = 5000
/** How much of a note is read to describe it. */
const HEAD_BYTES = 2048
const MAX_TOP_FILE = 6000
const MAX_DESCRIPTION = 110
/** The whole map, so a huge folder can't swamp the prompt. */
const MAX_MAP = 18_000

export interface MapEntry {
  path: string
  bytes: number
  modified: number
  title: string | null
  description: string | null
}

/** A note's title (its first heading) and what it's about (its first line of prose). */
export function describe(head: string, ext = '.md'): { title: string | null; description: string | null } {
  // A data file: its first line (a CSV's columns, a YAML's first key) says what's in it.
  if (ext !== '.md' && ext !== '.markdown' && ext !== '.txt') {
    const first = head.split('\n').find((l) => l.trim())?.trim() ?? null
    return { title: null, description: first && first.length > MAX_DESCRIPTION ? `${first.slice(0, MAX_DESCRIPTION - 1)}…` : first }
  }
  let title: string | null = null
  let description: string | null = null
  const lines = head.replace(/^---\n[\s\S]*?\n---\n/, '').split('\n')
  for (const raw of lines) {
    const line = raw.trim()
    if (!line || /^(```|<!--|---|\|[-: |]+\||!\[)/.test(line)) continue
    const heading = /^#{1,6}\s+(.*)$/.exec(line)
    if (heading) {
      if (!title) title = heading[1]!.replace(/[*`]/g, '').trim()
      continue
    }
    description = line
      .replace(/^([-*+>]|\d+[.)])\s+/, '')
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/[*`]/g, '')
      .trim()
    if (description) break
  }
  if (description && description.length > MAX_DESCRIPTION) description = `${description.slice(0, MAX_DESCRIPTION - 1).trimEnd()}…`
  return { title: title || null, description: description || null }
}

function readHead(file: string): string {
  const fd = openSync(file, 'r')
  try {
    const buf = Buffer.alloc(HEAD_BYTES)
    return buf.subarray(0, readSync(fd, buf, 0, HEAD_BYTES, 0)).toString('utf8')
  } finally {
    closeSync(fd)
  }
}

/** The notes in a folder, most recently edited first. Also how many other files there are. */
export function scanFolder(root: string): { entries: MapEntry[]; others: number } {
  const entries: MapEntry[] = []
  let others = 0
  let visited = 0
  const walk = (dir: string, depth: number): void => {
    let names: string[]
    try {
      names = readdirSync(dir).sort()
    } catch {
      return
    }
    for (const name of names) {
      if (name.startsWith('.') || ++visited > MAX_VISITED) continue
      const full = join(dir, name)
      let st
      try {
        st = statSync(full)
      } catch {
        continue
      }
      if (st.isDirectory()) {
        if (depth < MAX_DEPTH && !SKIP_DIRS.has(name)) walk(full, depth + 1)
      } else if (!st.isFile()) continue
      else if (!NOTE_TYPES.has(extname(name).toLowerCase()) || entries.length >= MAX_FILES) others++
      else {
        let about: { title: string | null; description: string | null } = { title: null, description: null }
        try {
          about = describe(readHead(full), extname(name).toLowerCase())
        } catch {
          // Unreadable: listed without a description.
        }
        entries.push({ path: relative(root, full), bytes: st.size, modified: st.mtimeMs, ...about })
      }
    }
  }
  walk(root, 0)
  entries.sort((a, b) => b.modified - a.modified)
  return { entries, others }
}

const size = (bytes: number): string => (bytes < 1024 ? `${bytes} B` : `${Math.round(bytes / 1024)} KB`)
const day = (ms: number): string => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

export function entryLine(e: MapEntry, withAbout = true): string {
  const about = withAbout ? [e.title, e.description].filter(Boolean).join(': ') : ''
  return `- ${e.path} (${size(e.bytes)}, edited ${day(e.modified)})${about ? ` ${about}` : ''}`
}

/** The map as it goes in the system prompt. */
export function formatMap(root: string, scan: { entries: MapEntry[]; others: number }, topFiles: { name: string; text: string }[]): string {
  const head = `## Map of ${root}\nBuilt by NateBot from the files just now, most recently edited first. Use it instead of listing the folder, and open only the files the question needs.`
  const tops = topFiles.map(
    (f) => `### ${f.name} (in full)\n${f.text.length > MAX_TOP_FILE ? `${f.text.slice(0, MAX_TOP_FILE)}\n…(cut short: read the file for the rest)` : f.text}`
  )
  const rest = scan.others ? `\n(and ${scan.others} other file${scan.others === 1 ? '' : 's'}: code, images, data)` : ''
  const fixed = [head, ...tops].join('\n\n').length + rest.length + 40
  // Newest first, so if the map has to be cut, the files left without a description are the stale ones.
  const lines: string[] = []
  let used = fixed
  for (const e of scan.entries) {
    let line = entryLine(e)
    if (used + line.length > MAX_MAP) line = entryLine(e, false)
    if (used + line.length > MAX_MAP) {
      lines.push(`- …and ${scan.entries.length - lines.length} more notes`)
      break
    }
    lines.push(line)
    used += line.length + 1
  }
  return [head, ...tops, `### Notes\n${lines.join('\n')}${rest}`].join('\n\n')
}

export function folderMap(root: string): string {
  const topFiles: { name: string; text: string }[] = []
  for (const name of TOP_FILES) {
    try {
      const text = readFileSync(join(root, name), 'utf8').trim()
      if (text) topFiles.push({ name, text })
    } catch {
      // Not there.
    }
  }
  const scan = scanFolder(root)
  scan.entries = scan.entries.filter((e) => !TOP_FILES.includes(e.path))
  return formatMap(root, scan, topFiles)
}
