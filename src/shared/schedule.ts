// Friendly schedule <-> cron conversion used by the routine picker.

export type ScheduleSpec =
  | { kind: 'daily'; time: string }
  | { kind: 'weekdays'; time: string }
  | { kind: 'weekly'; day: number; time: string }
  | { kind: 'hourly'; every: number; minute: number }
  | { kind: 'custom'; cron: string }

export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

const isInt = (s: string | undefined, min: number, max: number): boolean =>
  s !== undefined && /^\d+$/.test(s) && Number(s) >= min && Number(s) <= max

const pad = (n: number): string => String(n).padStart(2, '0')

function splitTime(time: string): [number, number] {
  const [h, m] = time.split(':').map(Number)
  return [h ?? 0, m ?? 0]
}

export function toCron(spec: ScheduleSpec): string {
  switch (spec.kind) {
    case 'daily': {
      const [h, m] = splitTime(spec.time)
      return `${m} ${h} * * *`
    }
    case 'weekdays': {
      const [h, m] = splitTime(spec.time)
      return `${m} ${h} * * 1-5`
    }
    case 'weekly': {
      const [h, m] = splitTime(spec.time)
      return `${m} ${h} * * ${spec.day}`
    }
    case 'hourly':
      return spec.every === 1 ? `${spec.minute} * * * *` : `${spec.minute} */${spec.every} * * *`
    case 'custom':
      return spec.cron.trim()
  }
}

export function fromCron(cron: string): ScheduleSpec {
  const parts = cron.trim().split(/\s+/)
  if (parts.length !== 5) return { kind: 'custom', cron }
  const [min, hour, dom, mon, dow] = parts as [string, string, string, string, string]
  if (dom !== '*' || mon !== '*' || !isInt(min, 0, 59)) return { kind: 'custom', cron }

  if (dow === '*') {
    if (hour === '*') return { kind: 'hourly', every: 1, minute: Number(min) }
    const step = /^\*\/(\d+)$/.exec(hour)
    if (step && isInt(step[1], 1, 23)) return { kind: 'hourly', every: Number(step[1]), minute: Number(min) }
  }
  if (!isInt(hour, 0, 23)) return { kind: 'custom', cron }
  const time = `${pad(Number(hour))}:${pad(Number(min))}`
  if (dow === '*') return { kind: 'daily', time }
  if (dow === '1-5') return { kind: 'weekdays', time }
  if (isInt(dow, 0, 6)) return { kind: 'weekly', day: Number(dow), time }
  return { kind: 'custom', cron }
}

export function formatTime(time: string): string {
  const [h, m] = splitTime(time)
  const suffix = h < 12 ? 'AM' : 'PM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${pad(m)} ${suffix}`
}

export function describeCron(cron: string): string {
  const spec = fromCron(cron)
  switch (spec.kind) {
    case 'daily':
      return `Every day at ${formatTime(spec.time)}`
    case 'weekdays':
      return `Weekdays at ${formatTime(spec.time)}`
    case 'weekly':
      return `${DAY_NAMES[spec.day]}s at ${formatTime(spec.time)}`
    case 'hourly':
      return spec.every === 1
        ? `Every hour at :${pad(spec.minute)}`
        : `Every ${spec.every} hours at :${pad(spec.minute)}`
    case 'custom':
      return `Custom (${spec.cron})`
  }
}

// ---- matching (for catching up on routines missed while the Mac slept) ----

const MINUTE = 60_000

/** The values one cron field allows: "*", "5", "1-5", "*\/15", "0,30", "1-10/2". Null if invalid. */
function fieldValues(field: string, min: number, max: number): Set<number> | null {
  const out = new Set<number>()
  for (const part of field.split(',')) {
    const m = /^(\*|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/.exec(part)
    if (!m) return null
    const step = m[4] ? Number(m[4]) : 1
    const from = m[1] === '*' ? min : Number(m[2])
    const to = m[1] === '*' ? max : m[3] ? Number(m[3]) : m[4] ? max : from
    if (step < 1 || from < min || to > max || from > to) return null
    for (let v = from; v <= to; v += step) out.add(v)
  }
  return out
}

/** A predicate for a 5-field cron (a 6th, leading seconds field is ignored), or null if invalid. */
export function cronMatcher(cron: string): ((d: Date) => boolean) | null {
  let parts = cron.trim().split(/\s+/)
  if (parts.length === 6) parts = parts.slice(1)
  if (parts.length !== 5) return null
  const [minF, hourF, domF, monF, dowF] = parts as [string, string, string, string, string]
  const minutes = fieldValues(minF, 0, 59)
  const hours = fieldValues(hourF, 0, 23)
  const days = fieldValues(domF, 1, 31)
  const months = fieldValues(monF, 1, 12)
  const weekdays = fieldValues(dowF, 0, 7)
  if (!minutes || !hours || !days || !months || !weekdays) return null
  if (weekdays.has(7)) weekdays.add(0)
  // Standard cron: when both day fields are restricted, either one matching is enough.
  const domAny = domF === '*'
  const dowAny = dowF === '*'
  return (d) => {
    if (!minutes.has(d.getMinutes()) || !hours.has(d.getHours()) || !months.has(d.getMonth() + 1)) return false
    const dom = days.has(d.getDate())
    const dow = weekdays.has(d.getDay())
    return domAny || dowAny ? dom && dow : dom || dow
  }
}

/** The most recent minute at or before `now`, within `windowMs`, that the cron matches. */
export function lastOccurrence(cron: string, now: number, windowMs: number): number | null {
  const matches = cronMatcher(cron)
  if (!matches) return null
  const start = Math.floor(now / MINUTE) * MINUTE
  for (let t = start; t > now - windowMs; t -= MINUTE) if (matches(new Date(t))) return t
  return null
}
