// Quiet hours: notifications are held overnight (reminders you set still ring)
// and summed up in one notification when quiet hours end.

/** Minutes since midnight for "HH:MM", or null. */
export function minutes(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm)
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  return h < 24 && min < 60 ? h * 60 + min : null
}

/** Whether `at` falls in quiet hours from `start` to `end` (which may wrap past midnight). */
export function inQuietHours(at: Date, start: string, end: string): boolean {
  const s = minutes(start)
  const e = minutes(end)
  if (s === null || e === null || s === e) return false
  const now = at.getHours() * 60 + at.getMinutes()
  return s < e ? now >= s && now < e : now >= s || now < e
}

/** "3 replies · 1 routine finished · 2 need your approval" from the held notification titles. */
export function digest(titles: string[]): string {
  const counts = new Map<string, number>()
  for (const t of titles) counts.set(t, (counts.get(t) ?? 0) + 1)
  const label = (t: string, n: number): string => {
    if (t === 'Replied') return `${n} repl${n > 1 ? 'ies' : 'y'}`
    if (t === 'Needs your approval') return `${n} need${n > 1 ? '' : 's'} your approval`
    if (t === 'New email') return `${n} email trigger${n > 1 ? 's' : ''}`
    return n > 1 ? `${n} × ${t.toLowerCase()}` : t.toLowerCase()
  }
  return [...counts].map(([t, n]) => label(t, n)).join(' · ')
}
