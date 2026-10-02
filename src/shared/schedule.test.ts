import { describe, expect, it } from 'vitest'
import { cronMatcher, describeCron, formatTime, fromCron, lastOccurrence, toCron, type ScheduleSpec } from './schedule'

describe('schedule <-> cron', () => {
  const specs: ScheduleSpec[] = [
    { kind: 'daily', time: '08:30' },
    { kind: 'weekdays', time: '07:05' },
    { kind: 'weekly', day: 0, time: '18:00' },
    { kind: 'hourly', every: 1, minute: 15 },
    { kind: 'hourly', every: 6, minute: 0 }
  ]

  it.each(specs)('round-trips $kind', (spec) => {
    expect(fromCron(toCron(spec))).toEqual(spec)
  })

  it('treats anything the picker cannot show as custom', () => {
    for (const cron of ['0 8 1 * *', '*/5 * * * *', '0 8 * * 1,3', '0 8 * *', 'nonsense']) {
      expect(fromCron(cron)).toEqual({ kind: 'custom', cron })
    }
  })

  it('describes schedules in plain words', () => {
    expect(describeCron('0 8 * * 1-5')).toBe('Weekdays at 8:00 AM')
    expect(describeCron('30 13 * * 5')).toBe('Fridays at 1:30 PM')
    expect(describeCron('0 */2 * * *')).toBe('Every 2 hours at :00')
    expect(describeCron('0 8 1 * *')).toBe('Custom (0 8 1 * *)')
  })

  it('formats midnight and noon as 12', () => {
    expect(formatTime('00:00')).toBe('12:00 AM')
    expect(formatTime('12:05')).toBe('12:05 PM')
  })
})

// Local time, like node-cron. 2 Oct 2026 is a Friday.
const at = (day: number, h: number, m: number): number => new Date(2026, 9, day, h, m).getTime()
const HOUR = 60 * 60_000

describe('cron matching', () => {
  it('matches the forms the routine picker writes', () => {
    expect(cronMatcher('0 8 * * 1-5')?.(new Date(at(2, 8, 0)))).toBe(true)
    expect(cronMatcher('0 8 * * 1-5')?.(new Date(at(3, 8, 0)))).toBe(false) // Saturday
    expect(cronMatcher('15 */6 * * *')?.(new Date(at(2, 12, 15)))).toBe(true)
    expect(cronMatcher('15 */6 * * *')?.(new Date(at(2, 13, 15)))).toBe(false)
  })

  it('handles lists, steps, Sunday as 7, and day-of-month OR day-of-week', () => {
    expect(cronMatcher('0,30 9 * * *')?.(new Date(at(2, 9, 30)))).toBe(true)
    expect(cronMatcher('0 18 * * 7')?.(new Date(at(4, 18, 0)))).toBe(true) // Sunday
    expect(cronMatcher('0 9 1 * 5')?.(new Date(at(2, 9, 0)))).toBe(true) // a Friday that isn't the 1st
  })

  it('ignores a leading seconds field and rejects nonsense', () => {
    expect(cronMatcher('0 0 8 * * *')?.(new Date(at(2, 8, 0)))).toBe(true)
    for (const bad of ['nonsense', '0 8 * *', '61 8 * * *', '0 8 * * MON']) expect(cronMatcher(bad)).toBeNull()
  })

  it('finds the latest scheduled time within the window', () => {
    expect(lastOccurrence('0 8 * * *', at(2, 9, 14), 12 * HOUR)).toBe(at(2, 8, 0))
    expect(lastOccurrence('0 8 * * *', at(2, 8, 0) + 30_000, 12 * HOUR)).toBe(at(2, 8, 0))
    expect(lastOccurrence('0 8 * * *', at(2, 21, 0), 12 * HOUR)).toBeNull()
    expect(lastOccurrence('0 18 * * *', at(3, 2, 0), 12 * HOUR)).toBe(at(2, 18, 0))
  })
})
