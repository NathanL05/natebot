// Run bookkeeping: per-agent usage totals, and opening a database from before tokens were recorded.
import { DatabaseSync } from 'node:sqlite'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdtempSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { DELETED_AGENT_ID } from '@shared/usage'
import { Db } from './db'

const tokens = (input: number, output: number, costUsd: number | null) => ({ input, cacheWrite: 0, cacheRead: 0, output, costUsd })

describe('usageByAgent', () => {
  it('adds up each agent’s finished runs since the cut-off', () => {
    const db = new Db(':memory:')
    db.startRun('r1', 'email', 'chat')
    db.finishRun('r1', true, 'ok', { input: 10, cacheWrite: 5000, cacheRead: 6000, output: 300, costUsd: 0.04 })
    db.startRun('r2', 'email', 'routine')
    db.finishRun('r2', true, 'ok', tokens(100, 50, 0.01))
    db.startRun('r3', 'planner', 'room')
    db.finishRun('r3', false, 'timed out') // no token report
    db.startRun('r4', 'planner', 'chat') // still running: not counted

    const rows = Object.fromEntries(db.usageByAgent(0).map((r) => [r.agentId, r]))
    expect(rows['email']).toMatchObject({ runs: 2, inputTokens: 11_110, outputTokens: 350, unmeasuredRuns: 0 })
    expect(rows['email']?.costUsd).toBeCloseTo(0.05)
    expect(rows['planner']).toMatchObject({ runs: 1, inputTokens: 0, outputTokens: 0, costUsd: 0, unmeasuredRuns: 1 })
    expect(db.usageByAgent(Date.now() + 1000)).toEqual([])
  })

  it('keeps a deleted agent’s usage under one id, not on the others', () => {
    const db = new Db(':memory:')
    db.startRun('r1', 'old-agent', 'chat')
    db.finishRun('r1', true, 'ok', tokens(100, 10, 0.1))
    db.startRun('r2', 'email', 'chat')
    db.finishRun('r2', true, 'ok', tokens(50, 5, 0.05))
    db.deleteAgent('old-agent')
    expect(db.usageByAgent(0).map((r) => [r.agentId, r.runs])).toEqual(expect.arrayContaining([[DELETED_AGENT_ID, 1], ['email', 1]]))
  })

  it('upgrades a database made before tokens were recorded', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'natebot-db-')), 'data.db')
    const old = new DatabaseSync(file)
    old.exec(`CREATE TABLE runs (id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, source TEXT NOT NULL,
      started_at INTEGER NOT NULL, ended_at INTEGER, ok INTEGER, summary TEXT);
      INSERT INTO runs VALUES ('old', 'email', 'chat', 1000, 2000, 1, 'done');`)
    old.close()

    const db = new Db(file)
    expect(db.usageByAgent(0)).toEqual([{ agentId: 'email', runs: 1, inputTokens: 0, outputTokens: 0, costUsd: 0, unmeasuredRuns: 1 }])
    db.close()
  })
})

describe('reminders', () => {
  const reminder = (id: string, at: number, agentId = 'planner') => ({ id, agentId, messageId: 'm1', at, kind: 'message' as const, text: id, status: 'scheduled' as const })

  it('lists what is due soonest first and finds the next time', () => {
    const db = new Db(':memory:')
    db.saveReminder(reminder('later', 3000))
    db.saveReminder(reminder('soon', 1000))
    db.saveReminder(reminder('other', 2000, 'email'))
    expect(db.nextReminderAt()).toBe(1000)
    expect(db.scheduledReminders(2000).map((r) => r.id)).toEqual(['soon', 'other'])
    expect(db.scheduledCount('planner')).toBe(2)

    db.setReminderStatus('soon', 'done')
    expect(db.nextReminderAt()).toBe(2000)
    expect(db.reminder('soon')?.status).toBe('done')

    db.deleteAgent('email')
    expect(db.scheduledReminders().map((r) => r.id)).toEqual(['later'])
  })
})
