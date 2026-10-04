// One-off reminders an agent sets from a chat with a ```reminders block. They're
// scheduled straight away (the user can cancel them): a 'message' reminder just
// posts its text at that time, and a 'task' reminder runs the agent then, with
// the same tools and permissions it has now, so neither can do more than the
// agent could already do in the moment.
import { randomUUID } from 'node:crypto'
import { REMINDER_REPEATS, type Reminder, type ReminderRepeat } from '@shared/types'
import type { ParsedReminder } from './claude/stream'

/** Most reminders one reply can set. */
export const MAX_PER_REPLY = 5
/** Most reminders an agent can have waiting, so a reminder that sets reminders can't run away. */
export const MAX_SCHEDULED = 20
const MAX_AHEAD = 366 * 86_400_000
/** A time this far in the past still counts as "now" (the agent rounding the current time). */
const GRACE_MS = 5 * 60_000
/** A task missed by more than this (the Mac was asleep or NateBot closed) is dropped instead of run. */
export const TASK_CATCH_UP = 12 * 60 * 60_000
/** The timer never waits longer than this, so sleep or a clock change can't strand it. */
const MAX_WAIT = 15 * 60_000
/** Something due but held back (e.g. Claude Code not ready yet) is retried this often. */
const RETRY_WAIT = 60_000

const TIME_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/

/** "2026-10-03T19:00" (local time, as agents are asked to write it), or with an offset. */
export function parseTime(at: string): number | null {
  const s = at.trim()
  if (!TIME_RE.test(s)) return null
  const t = new Date(s.replace(' ', 'T').replace(/([+-]\d{2})(\d{2})$/, '$1:$2')).getTime()
  return Number.isFinite(t) ? t : null
}

/**
 * Turns the agent's requests into reminders. Unreadable, past or far-off times and
 * anything over the limits are dropped and described in `problems`.
 */
export function resolveReminders(
  requests: ParsedReminder[],
  agentId: string,
  messageId: string,
  now: number,
  scheduled = 0
): { reminders: Reminder[]; problems: string[] } {
  const reminders: Reminder[] = []
  const problems: string[] = []
  for (const r of requests) {
    const at = parseTime(r.at)
    if (at === null) problems.push(`"${r.at}" isn't a time NateBot understands, so that reminder wasn't set.`)
    else if (at < now - GRACE_MS) problems.push(`A reminder for ${r.at} is in the past, so it wasn't set.`)
    else if (at > now + MAX_AHEAD) problems.push(`A reminder for ${r.at} is more than a year away, so it wasn't set.`)
    else if (reminders.length >= MAX_PER_REPLY) problems.push(`Only ${MAX_PER_REPLY} reminders can be set at once; the rest were ignored.`)
    else if (scheduled + reminders.length >= MAX_SCHEDULED) problems.push(`This agent already has ${MAX_SCHEDULED} reminders waiting, so no more were set.`)
    else {
      const repeat = REMINDER_REPEATS.includes(r.repeat as ReminderRepeat) ? { repeat: r.repeat as ReminderRepeat } : {}
      reminders.push({ id: randomUUID(), agentId, messageId, at: Math.max(at, now), kind: r.kind, text: r.text.slice(0, 2000), status: 'scheduled', ...repeat })
    }
  }
  return { reminders, problems: [...new Set(problems)] }
}

/** A repeating reminder's next time after it went off: same time of day, later than `now`. */
export function nextRepeat(at: number, repeat: ReminderRepeat, now: number): number {
  const d = new Date(at)
  do {
    d.setDate(d.getDate() + (repeat === 'weekly' ? 7 : 1))
    if (repeat === 'weekdays') while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1)
  } while (d.getTime() <= now)
  return d.getTime()
}

/** What to do with a reminder now: run it, mark it missed, or nothing yet. */
export function dueAction(r: Reminder, now: number): 'run' | 'miss' | null {
  if (r.status !== 'scheduled' || r.at > now) return null
  // A missed message is still worth showing late; stale work (e.g. "check the 9am train") isn't.
  return r.kind === 'task' && now - r.at > TASK_CATCH_UP ? 'miss' : 'run'
}

/** One timer for the next reminder due. */
export class ReminderClock {
  private timer: NodeJS.Timeout | undefined

  constructor(
    private next: () => number | null,
    private onDue: () => void
  ) {}

  arm(now = Date.now()): void {
    clearTimeout(this.timer)
    const at = this.next()
    if (at === null) return
    // Everything already due was handled just before this, so a past time means it's being held back.
    const wait = at <= now ? RETRY_WAIT : Math.min(at - now, MAX_WAIT)
    this.timer = setTimeout(() => this.onDue(), wait)
  }

  stop(): void {
    clearTimeout(this.timer)
  }
}
