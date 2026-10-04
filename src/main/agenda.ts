// Today's agenda: events from Google Calendar, open tasks from Google Tasks and
// Apple Reminders due by the end of today. Read directly with the Connect sign-ins
// (Google APIs) or osascript (Reminders), so showing it never runs Claude.
import { execFile } from 'node:child_process'
import type { Agenda } from '@shared/types'
import { GoogleToken } from './google-api'

const DAY = 86_400_000

interface CalEvent {
  summary?: string
  location?: string
  start?: { dateTime?: string; date?: string }
  end?: { dateTime?: string; date?: string }
  status?: string
}

/** Calendar events as Google returns them → the agenda's shape (all-day dates are local days). */
export function toEvents(items: CalEvent[]): Agenda['events'] {
  const time = (t?: { dateTime?: string; date?: string }): number =>
    t?.dateTime ? Date.parse(t.dateTime) : t?.date ? new Date(`${t.date}T00:00`).getTime() : 0
  return items
    .filter((e) => e.status !== 'cancelled')
    .map((e) => ({ title: e.summary || '(no title)', start: time(e.start), end: time(e.end), allDay: !e.start?.dateTime, location: e.location || null }))
    .sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start - b.start)
}

const REMINDERS_DUE = `function run(argv) {
  const until = new Date(Number(argv[0]))
  const app = Application('Reminders')
  const out = []
  for (const r of app.reminders.whose({ completed: false })()) {
    const due = r.dueDate()
    if (due && due <= until) out.push({ title: r.name(), due: due.getTime() })
    if (out.length >= 30) break
  }
  return JSON.stringify(out)
}`

function remindersDue(until: number): Promise<Agenda['tasks']> {
  return new Promise((resolve, reject) => {
    execFile('/usr/bin/osascript', ['-l', 'JavaScript', '-e', REMINDERS_DUE, String(until)], { timeout: 30_000 }, (err, out) => {
      if (err) return reject(new Error('Reminders could not be read'))
      try {
        resolve((JSON.parse(out) as { title: string; due: number }[]).map((r) => ({ ...r, source: 'Reminders' as const })))
      } catch {
        resolve([])
      }
    })
  })
}

export class AgendaReader {
  private calendar: GoogleToken
  private tasks: GoogleToken
  private cache: { at: number; agenda: Agenda } | null = null

  constructor(
    tokenPath: (server: string) => string | null,
    private remindersConnected: () => boolean
  ) {
    this.calendar = new GoogleToken(() => tokenPath('gcal'))
    this.tasks = new GoogleToken(() => tokenPath('gtasks'))
  }

  async today(refresh = false): Promise<Agenda> {
    if (!refresh && this.cache && Date.now() - this.cache.at < 5 * 60_000) return this.cache.agenda
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    const end = start.getTime() + DAY
    const agenda: Agenda = {
      events: [],
      tasks: [],
      connected: { calendar: this.calendar.available(), tasks: this.tasks.available(), reminders: this.remindersConnected() },
      errors: []
    }
    const jobs: Promise<void>[] = []
    if (agenda.connected.calendar) {
      const q = new URLSearchParams({ timeMin: start.toISOString(), timeMax: new Date(end).toISOString(), singleEvents: 'true', orderBy: 'startTime', maxResults: '25' })
      jobs.push(
        this.calendar
          .fetchJson<{ items?: CalEvent[] }>(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${q}`)
          .then((r) => void (agenda.events = toEvents(r.items ?? [])))
          .catch(() => void agenda.errors.push('Calendar could not be read'))
      )
    }
    if (agenda.connected.tasks) {
      jobs.push(
        this.tasks
          .fetchJson<{ items?: { title?: string; due?: string }[] }>('https://tasks.googleapis.com/tasks/v1/lists/@default/tasks?showCompleted=false&maxResults=30')
          .then((r) => {
            for (const t of r.items ?? []) {
              // Google Tasks due dates are dates (midnight UTC): read them as that local day.
              const due = t.due ? new Date(`${t.due.slice(0, 10)}T09:00`).getTime() : null
              if (t.title && (due === null || due < end)) agenda.tasks.push({ title: t.title, due, source: 'Google Tasks' })
            }
          })
          .catch(() => void agenda.errors.push('Google Tasks could not be read'))
      )
    }
    if (agenda.connected.reminders) {
      jobs.push(
        remindersDue(end)
          .then((r) => void agenda.tasks.push(...r))
          .catch((e: Error) => void agenda.errors.push(e.message))
      )
    }
    await Promise.all(jobs)
    agenda.tasks.sort((a, b) => (a.due ?? Infinity) - (b.due ?? Infinity))
    this.cache = { at: Date.now(), agenda }
    return agenda
  }
}
