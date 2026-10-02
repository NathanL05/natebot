// Catching up on routines missed while the Mac slept or NateBot was closed:
// each scheduled time runs at most once, whether node-cron or the catch-up
// gets there first.
import { describe, expect, it } from 'vitest'
import { dueRun, type Checkpoint } from './scheduler'

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
