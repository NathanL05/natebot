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

export { describeTool } from '@shared/tools'

export function basename(path: string): string {
  return path.split('/').pop() ?? path
}

/** When something is due: "Today 7:00 PM", "Tomorrow 8:30 AM", "Mon 5 Oct 9:00 AM". */
export function dueTime(ts: number): string {
  const days = Math.round((startOfDay(ts) - startOfDay(Date.now())) / DAY)
  const time = clockTime(ts)
  if (days === 0) return `Today ${time}`
  if (days === 1) return `Tomorrow ${time}`
  if (days === -1) return `Yesterday ${time}`
  return `${new Date(ts).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })} ${time}`
}
