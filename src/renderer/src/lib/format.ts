const DAY = 86_400_000

function startOfDay(ts: number): number {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export function clockTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

/** Sidebar style: "8:02 AM", "Yesterday", "Mon", "21/09/2026". */
export function listTime(ts: number): string {
  if (!ts) return ''
  const days = Math.round((startOfDay(Date.now()) - startOfDay(ts)) / DAY)
  if (days <= 0) return clockTime(ts)
  if (days === 1) return 'Yesterday'
  if (days < 7) return new Date(ts).toLocaleDateString([], { weekday: 'short' })
  return new Date(ts).toLocaleDateString()
}

/** Chat separator style: "Today 8:02 AM", "Yesterday 6:10 PM", "Mon 21 Sep 9:00 AM". */
export function separatorTime(ts: number): string {
  const days = Math.round((startOfDay(Date.now()) - startOfDay(ts)) / DAY)
  const time = clockTime(ts)
  if (days <= 0) return `Today ${time}`
  if (days === 1) return `Yesterday ${time}`
  return `${new Date(ts).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })} ${time}`
}

export function relativeFuture(ts: number): string {
  const diff = ts - Date.now()
  if (diff <= 0) return 'now'
  const mins = Math.round(diff / 60_000)
  if (mins < 60) return `in ${mins} min`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `in ${hours} h`
  return new Date(ts).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const letters = parts.length > 1 ? [parts[0], parts[parts.length - 1]] : parts
  return letters.map((p) => p?.[0]?.toUpperCase() ?? '').join('') || '?'
}

const SERVER_NAMES: Record<string, string> = {
  gmail: 'Gmail',
  gcal: 'Calendar',
  gdrive: 'Drive',
  github: 'GitHub',
  slack: 'Slack',
  notion: 'Notion'
}

const BUILTIN_NAMES: Record<string, string> = {
  WebSearch: 'Web search',
  WebFetch: 'Read web page',
  Read: 'Read file',
  Write: 'Write file',
  Edit: 'Edit file',
  Bash: 'Run command',
  Glob: 'Find files',
  Grep: 'Search files',
  TodoWrite: 'Update checklist'
}

/** "mcp__gmail__search_threads" → { source: "Gmail", action: "search_threads" } */
export function describeTool(name: string): { source: string; action: string | null } {
  const mcp = /^mcp__(.+?)__(.+)$/.exec(name)
  if (mcp) {
    const server = mcp[1] ?? ''
    const pretty = SERVER_NAMES[server] ?? server.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
    return { source: pretty, action: mcp[2] ?? null }
  }
  return { source: BUILTIN_NAMES[name] ?? name, action: null }
}

export function basename(path: string): string {
  return path.split('/').pop() ?? path
}
