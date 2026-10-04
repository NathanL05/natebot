import { describe, expect, it } from 'vitest'
import { toEvents } from './agenda'

describe('agenda', () => {
  it('turns calendar events into rows, all-day first, cancelled dropped', () => {
    const rows = toEvents([
      { summary: 'Lecture', start: { dateTime: '2026-10-05T10:00:00+01:00' }, end: { dateTime: '2026-10-05T11:00:00+01:00' }, location: 'Room 2' },
      { summary: 'Holiday', start: { date: '2026-10-05' }, end: { date: '2026-10-06' } },
      { summary: 'Gone', status: 'cancelled', start: { dateTime: '2026-10-05T09:00:00Z' } },
      { start: { dateTime: '2026-10-05T08:00:00+01:00' }, end: { dateTime: '2026-10-05T08:30:00+01:00' } }
    ])
    expect(rows.map((r) => [r.title, r.allDay])).toEqual([
      ['Holiday', true],
      ['(no title)', false],
      ['Lecture', false]
    ])
    expect(rows[2]?.location).toBe('Room 2')
  })
})
