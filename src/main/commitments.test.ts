import { describe, expect, it } from 'vitest'
import type { Commitment } from '@shared/types'
import { commitmentsBlock, daysOverdue, isDate, mergeCommitments, newCommitmentId, nudgeAt, parseCommitment, sameText } from './commitments'

const at = (s: string): number => new Date(s).getTime()
const c = (over: Partial<Commitment>): Commitment => ({
  id: 'c00000001',
  agentId: 'straight-talk',
  text: 'Backfill the log',
  due: '2026-10-18',
  status: 'open',
  createdAt: at('2026-10-16T13:00'),
  updatedAt: at('2026-10-16T13:00'),
  ...over
})

describe('commitments', () => {
  it('only accepts real dates', () => {
    expect(isDate('2026-10-24')).toBe(true)
    expect(isDate('2026-02-30')).toBe(false)
    expect(isDate('24/10/2026')).toBe(false)
    expect(isDate(20261024)).toBe(false)
  })

  it('parses new entries and updates, and drops entries naming nothing', () => {
    expect(parseCommitment({ text: '  Email   Ramlan ', due: '2026-10-24' })).toEqual({ text: 'Email Ramlan', due: '2026-10-24' })
    expect(parseCommitment({ id: 'c1a2b3c4d', status: 'done' })).toEqual({ id: 'c1a2b3c4d', status: 'done' })
    expect(parseCommitment({ id: 'c1a2b3c4d', status: 'maybe', due: 'Friday' })).toEqual({ id: 'c1a2b3c4d' })
    expect(parseCommitment({ due: '2026-10-24' })).toBeNull()
    expect(parseCommitment({ id: 'not-an-id' })).toBeNull()
    expect(newCommitmentId()).toMatch(/^c[0-9a-f]{8}$/)
  })

  it('matches the same commitment written slightly differently', () => {
    expect(sameText('Email Ramlan!', 'email  ramlan')).toBe(true)
    expect(sameText('Email Ramlan', 'Email Frank')).toBe(false)
  })

  it('nudges at 9:00 on the due day, only while that is ahead', () => {
    expect(nudgeAt('2026-10-24', at('2026-10-20T12:00'))).toBe(at('2026-10-24T09:00'))
    expect(nudgeAt('2026-10-24', at('2026-10-24T10:00'))).toBeNull()
  })

  it('counts whole days overdue', () => {
    expect(daysOverdue('2026-10-18', at('2026-10-18T23:00'))).toBe(0)
    expect(daysOverdue('2026-10-18', at('2026-10-20T08:00'))).toBe(2)
    expect(daysOverdue('2026-10-25', at('2026-10-20T08:00'))).toBe(0)
  })

  it('shows the agent open and recently closed commitments, open first', () => {
    const now = at('2026-10-20T08:00')
    const block = commitmentsBlock(
      [
        c({ id: 'c00000002', text: 'Email Ramlan', due: '2026-10-24' }),
        c({}),
        c({ id: 'c00000003', text: 'Go done-test', status: 'done', updatedAt: at('2026-10-19T20:00') }),
        c({ id: 'c00000004', text: 'Old thing', status: 'missed', updatedAt: at('2026-09-01T10:00') })
      ],
      now
    )
    const lines = block?.split('\n') ?? []
    expect(lines[0]).toContain("Commitments you're tracking")
    expect(lines[1]).toBe('- c00000001 · Backfill the log · due Sun 18 Oct · OVERDUE by 2 days')
    expect(lines[2]).toBe('- c00000002 · Email Ramlan · due Sat 24 Oct · open')
    expect(lines[3]).toBe('- c00000003 · Go done-test · due Sun 18 Oct · done (marked Mon 19 Oct)')
    expect(lines).toHaveLength(4)
    expect(commitmentsBlock([c({ status: 'done', updatedAt: at('2026-09-01T10:00') })], now)).toBeNull()
  })

  it('records new commitments and updates existing ones by id or matching text', () => {
    const now = at('2026-10-20T08:00')
    const mine = [c({}), c({ id: 'c00000002', text: 'Email Ramlan', due: '2026-10-24' })]
    const { save, changes } = mergeCommitments(
      mine,
      [
        { id: 'c00000001', status: 'done' },
        { text: 'email ramlan', due: '2026-10-27' },
        { text: 'Book the GP', due: '2026-10-22' },
        { id: 'c00000009', status: 'done' },
        { text: 'No date' },
        { id: 'c00000002', due: '2026-10-27' }
      ],
      'straight-talk',
      now
    )
    expect(changes).toEqual(['✓ Backfill the log', 'Email Ramlan (now due 2026-10-27)', '+ Book the GP (due 2026-10-22)'])
    expect(save.map((x) => [x.text, x.status, x.due, x.updatedAt === now])).toEqual([
      ['Backfill the log', 'done', '2026-10-18', true],
      ['Email Ramlan', 'open', '2026-10-27', true],
      ['Book the GP', 'open', '2026-10-22', true]
    ])
  })

  it('stops adding at the open limit', () => {
    const full = Array.from({ length: 30 }, (_, i) => c({ id: `c${String(i).padStart(8, '0')}`, text: `t${i}` }))
    expect(mergeCommitments(full, [{ text: 'One more', due: '2026-10-30' }], 'straight-talk', 0).save).toEqual([])
  })
})
