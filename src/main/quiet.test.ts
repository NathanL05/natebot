import { describe, expect, it } from 'vitest'
import { digest, inQuietHours } from './quiet'

const at = (h: number, m = 0): Date => new Date(2026, 9, 4, h, m)

describe('quiet hours', () => {
  it('handles overnight and same-day ranges', () => {
    expect(inQuietHours(at(23), '22:30', '07:30')).toBe(true)
    expect(inQuietHours(at(3), '22:30', '07:30')).toBe(true)
    expect(inQuietHours(at(7, 30), '22:30', '07:30')).toBe(false)
    expect(inQuietHours(at(13), '12:00', '14:00')).toBe(true)
    expect(inQuietHours(at(15), '12:00', '14:00')).toBe(false)
    expect(inQuietHours(at(3), 'bad', '07:00')).toBe(false)
  })

  it('sums up what was held', () => {
    expect(digest(['Replied', 'Replied', 'Routine finished', 'Needs your approval'])).toBe('2 replies · routine finished · 1 needs your approval')
  })
})
