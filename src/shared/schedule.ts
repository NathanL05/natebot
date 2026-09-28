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
