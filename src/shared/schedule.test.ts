import { describe, expect, it } from 'vitest'
import { describeCron, formatTime, fromCron, toCron, type ScheduleSpec } from './schedule'

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
