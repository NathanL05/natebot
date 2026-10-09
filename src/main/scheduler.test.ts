// Catching up on routines missed while the Mac slept or NateBot was closed:
// each scheduled time runs at most once, whether node-cron or the catch-up
// gets there first.
import { describe, expect, it } from 'vitest'
import { dueRun, missedRun, routineChanges, syncedCheckpoint, type Checkpoint } from './scheduler'

// Local time, like node-cron. 2 Oct 2026 is a Friday.
const at = (day: number, h: number, m: number): number => new Date(2026, 9, day, h, m).getTime()
const DAILY = '0 8 * * *'
const yesterday: Checkpoint = { cron: DAILY, at: at(1, 8, 0) }

describe('dueRun', () => {
  it('runs a time missed while asleep once, on wake', () => {
    expect(dueRun(DAILY, yesterday, at(2, 9, 14), 'catch-up')).toBe(at(2, 8, 0))
  })

  it('does not run it again once it has been dealt with', () => {
    const handled: Checkpoint = { cron: DAILY, at: at(2, 9, 14) }
    expect(dueRun(DAILY, handled, at(2, 9, 30), 'catch-up')).toBeNull()
    // node-cron firing late after the wake is the same time: skipped too.
    expect(dueRun(DAILY, handled, at(2, 9, 15), 'tick')).toBeNull()
  })

  it('runs on time from node-cron', () => {
    expect(dueRun(DAILY, yesterday, at(2, 8, 0) + 200, 'tick')).toBe(at(2, 8, 0))
  })

  it('gives up on times older than the catch-up window', () => {
    expect(dueRun(DAILY, yesterday, at(2, 21, 0), 'catch-up')).toBeNull()
  })

  it('never catches up on a schedule it has no starting point for', () => {
    expect(dueRun(DAILY, null, at(2, 9, 14), 'catch-up')).toBeNull()
    expect(dueRun(DAILY, { cron: '0 7 * * *', at: at(1, 7, 0) }, at(2, 9, 14), 'catch-up')).toBeNull()
  })

  it('still runs node-cron ticks for crons the matcher cannot read', () => {
    expect(dueRun('0 8 * * MON', null, at(5, 8, 0), 'tick')).toBe(at(5, 8, 0))
    expect(dueRun('0 8 * * MON', null, at(5, 9, 0), 'catch-up')).toBeNull()
  })
})

describe('syncedCheckpoint', () => {
  const on = { id: 'main', enabled: true, cron: DAILY, prompt: 'Sweep' }

  it('keeps the checkpoint while the schedule is unchanged', () => {
    expect(syncedCheckpoint(on, yesterday, at(2, 15, 0))).toBe(yesterday)
  })

  it('never catches up on a time from before a routine was turned back on', () => {
    // Off on Monday, back on Friday at 3 PM, Mac wakes at 4 PM: 8 AM today must not run.
    const off = syncedCheckpoint({ ...on, enabled: false }, yesterday, at(2, 15, 0))
    expect(off).toBeNull()
    const reEnabled = syncedCheckpoint(on, off, at(2, 15, 0))
    expect(dueRun(DAILY, reEnabled, at(2, 16, 0), 'catch-up')).toBeNull()
  })

  it('starts a changed schedule counting from now', () => {
    const changed = syncedCheckpoint({ ...on, cron: '0 7 * * *' }, yesterday, at(2, 15, 0))
    expect(changed).toEqual({ cron: '0 7 * * *', at: at(2, 15, 0) })
  })
})

describe('routineChanges', () => {
  const morning = { id: 'main', enabled: true, cron: '0 8 * * *', prompt: 'Morning sweep' }
  const evening = { id: 'r2', enabled: true, cron: '0 19 * * *', prompt: 'Evening sweep' }

  it('describes added, changed, turned-off and removed routines', () => {
    expect(routineChanges([morning], [morning, evening])).toEqual(['Created routine: Every day at 7:00 PM'])
    expect(routineChanges([morning], [{ ...morning, prompt: 'Sweep' }])).toEqual(['Routine updated: Every day at 8:00 AM'])
    expect(routineChanges([morning, evening], [{ ...morning, enabled: false }])).toEqual([
      'Routine turned off: Every day at 8:00 AM',
      'Routine removed: Every day at 7:00 PM'
    ])
    expect(routineChanges([morning], [morning])).toEqual([])
  })
})

describe('missedRun', () => {
  it('reports a time missed for more than 12 hours, which dueRun no longer runs', () => {
    // Last ran Thursday 8:00; NateBot was closed until Friday 21:00.
    expect(dueRun(DAILY, yesterday, at(2, 21, 0), 'catch-up')).toBeNull()
    expect(missedRun(DAILY, yesterday, at(2, 21, 0))).toBe(at(2, 8, 0))
  })

  it('stays out of the way of a time that can still catch up, or was dealt with', () => {
    expect(missedRun(DAILY, yesterday, at(2, 9, 14))).toBeNull()
    // Missed Friday 8:00 by over 12h, but Saturday 8:00 is recent: dueRun runs that one.
    expect(missedRun(DAILY, yesterday, at(3, 9, 0))).toBeNull()
    expect(missedRun(DAILY, { cron: DAILY, at: at(2, 21, 0) }, at(2, 22, 0))).toBeNull()
  })

  it('says nothing without a checkpoint for this schedule', () => {
    expect(missedRun(DAILY, null, at(2, 21, 0))).toBeNull()
    expect(missedRun(DAILY, { cron: '0 7 * * *', at: at(1, 7, 0) }, at(2, 21, 0))).toBeNull()
  })
})
