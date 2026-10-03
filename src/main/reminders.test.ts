import { describe, expect, it } from 'vitest'
import type { Reminder } from '@shared/types'
import { dueAction, MAX_PER_REPLY, MAX_SCHEDULED, parseTime, resolveReminders, TASK_CATCH_UP } from './reminders'

const now = new Date(2026, 9, 3, 13, 0).getTime() // Sat 3 Oct 2026, 1pm local

describe('parseTime', () => {
  it('reads local times, with or without seconds or an offset', () => {
    expect(parseTime('2026-10-03T19:00')).toBe(new Date(2026, 9, 3, 19, 0).getTime())
    expect(parseTime('2026-10-03 19:00:30')).toBe(new Date(2026, 9, 3, 19, 0, 30).getTime())
    expect(parseTime('2026-10-03T19:00Z')).toBe(Date.UTC(2026, 9, 3, 19, 0))
    expect(parseTime('2026-10-03T19:00+0100')).toBe(Date.UTC(2026, 9, 3, 18, 0))
  })

  it('refuses dates without a time and free text', () => {
    for (const s of ['2026-10-03', 'tomorrow at 7', '19:00', '2026-13-45T99:99']) expect(parseTime(s)).toBeNull()
  })
})

describe('resolveReminders', () => {
  const req = (at: string, text = 'Gym') => ({ at, kind: 'message' as const, text })

  it('schedules valid reminders and explains the rest', () => {
    const { reminders, problems } = resolveReminders([req('2026-10-03T19:00'), req('soon'), req('2026-10-01T09:00'), req('2028-01-01T09:00')], 'planner', 'm1', now)
    expect(reminders).toMatchObject([{ agentId: 'planner', messageId: 'm1', at: new Date(2026, 9, 3, 19).getTime(), kind: 'message', text: 'Gym', status: 'scheduled' }])
    expect(problems).toHaveLength(3)
    expect(problems.join(' ')).toMatch(/understands.*past.*year/s)
  })

  it('treats a time a few minutes ago as now', () => {
    expect(resolveReminders([req('2026-10-03T12:58')], 'planner', 'm1', now).reminders[0]?.at).toBe(now)
  })

  it('caps reminders per reply and per agent', () => {
    const many = Array.from({ length: MAX_PER_REPLY + 2 }, () => req('2026-10-03T19:00'))
    expect(resolveReminders(many, 'planner', 'm1', now).reminders).toHaveLength(MAX_PER_REPLY)
    const full = resolveReminders([req('2026-10-03T19:00')], 'planner', 'm1', now, MAX_SCHEDULED)
    expect(full.reminders).toEqual([])
    expect(full.problems[0]).toMatch(/already has/)
  })
})

describe('dueAction', () => {
  const r = (over: Partial<Reminder>): Reminder => ({ id: 'r', agentId: 'a', messageId: 'm', at: now, kind: 'message', text: 'x', status: 'scheduled', ...over })

  it('runs due reminders, waits for future ones and ignores finished ones', () => {
    expect(dueAction(r({}), now)).toBe('run')
    expect(dueAction(r({ at: now + 1 }), now)).toBeNull()
    expect(dueAction(r({ status: 'cancelled' }), now)).toBeNull()
  })

  it('still shows a very late message, but drops a stale task', () => {
    const old = now - TASK_CATCH_UP - 1
    expect(dueAction(r({ at: old }), now)).toBe('run')
    expect(dueAction(r({ at: old, kind: 'task' }), now)).toBe('miss')
    expect(dueAction(r({ at: now - 60_000, kind: 'task' }), now)).toBe('run')
  })
})
