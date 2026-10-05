// Run bookkeeping: per-agent usage totals, and opening a database from before tokens were recorded.
import { DatabaseSync } from 'node:sqlite'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdtempSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { DELETED_AGENT_ID } from '@shared/usage'
import { Db, snippetOf } from './db'

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

describe('routine checkpoints and runs', () => {
  it('reads an older single checkpoint as the main routine', () => {
    const db = new Db(':memory:')
    db.setRoutineCheckpoints('email', { main: { cron: '0 8 * * *', at: 1 } })
    expect(db.routineCheckpoints('email')).toEqual({ main: { cron: '0 8 * * *', at: 1 } })
    // What older versions stored: one checkpoint, not a map.
    ;(db as unknown as { db: DatabaseSync }).db.prepare(`UPDATE agent_state SET routine_checkpoint = ? WHERE agent_id = 'email'`).run('{"cron":"0 7 * * *","at":5}')
    expect(db.routineCheckpoints('email')).toEqual({ main: { cron: '0 7 * * *', at: 5 } })
  })

  it("finds each routine's last run, counting older untagged runs as the main one", () => {
    const db = new Db(':memory:')
    db.startRun('old', 'email', 'routine')
    db.finishRun('old', true, 'old main run')
    db.startRun('eve', 'email', 'routine', 'r2')
    db.finishRun('eve', true, 'evening run')
    expect(db.lastRun('email', 'routine', 'main')?.summary).toBe('old main run')
    expect(db.lastRun('email', 'routine', 'r2')?.summary).toBe('evening run')
    expect(db.lastRun('email', 'routine', 'r3')).toBeNull()
  })
})

describe('message search', () => {
  const msg = (id: string, agentId: string, role: 'user' | 'agent' | 'system', text: string, createdAt: number) => ({ id, agentId, role, text, createdAt })

  it('finds your messages and replies case-insensitively, newest first, skipping system lines', () => {
    const db = new Db(':memory:')
    db.saveMessage(msg('a', 'email-agent', 'agent', 'Sarah needs the **report** by Friday.', 1))
    db.saveMessage(msg('b', 'planner', 'user', 'Block time for the Report', 2))
    db.saveMessage(msg('c', 'planner', 'system', 'Routine report ran', 3))
    db.saveMessage({ ...msg('d', 'room:x', 'agent', 'I can draft the report', 4), speakerId: 'planner' })
    expect(db.searchMessages('REPORT').map((h) => h.messageId)).toEqual(['d', 'b', 'a'])
    expect(db.searchMessages('report')[0]).toMatchObject({ chatId: 'room:x', speakerId: 'planner', role: 'agent' })
    expect(db.searchMessages('report').at(-1)?.snippet).toBe('Sarah needs the report by Friday.')
  })

  it('treats % and _ literally', () => {
    const db = new Db(':memory:')
    db.saveMessage(msg('a', 'planner', 'user', 'Save 20% this month', 1))
    db.saveMessage(msg('b', 'planner', 'user', 'Save 200 this month', 2))
    expect(db.searchMessages('20%').map((h) => h.messageId)).toEqual(['a'])
    expect(db.searchMessages('_')).toEqual([])
  })

  it('cuts long text down to the part around the match', () => {
    const text = `${'a '.repeat(100)}needle${' b'.repeat(100)}`
    const snip = snippetOf(text, 'needle')
    expect(snip.startsWith('…')).toBe(true)
    expect(snip.endsWith('…')).toBe(true)
    expect(snip).toContain('needle')
    expect(snip.length).toBeLessThan(140)
  })
})

describe('pending messages', () => {
  it('lists agent messages with a pending action or handoff, newest first', () => {
    const db = new Db(':memory:')
    const action = (status: string) => ({ id: 'a', type: 'send_email', summary: 'Reply', details: {}, status })
    db.saveMessage({ id: 'done', agentId: 'email', role: 'agent', text: 'x', createdAt: 1, actions: [action('done') as never] })
    db.saveMessage({ id: 'act', agentId: 'email', role: 'agent', text: 'x', createdAt: 2, actions: [action('pending') as never] })
    db.saveMessage({ id: 'hand', agentId: 'planner', role: 'agent', text: 'x', createdAt: 3, handoffs: [{ id: 'h', toAgentId: 'email', toName: 'Email', task: 't', status: 'pending' }] })
    expect(db.pendingMessages().map((m) => m.id)).toEqual(['hand', 'act'])
  })
})

describe('pins', () => {
  it('lists only pinned messages of one chat', () => {
    const db = new Db(':memory:')
    db.saveMessage({ id: 'a', agentId: 'planner', role: 'agent', text: 'Plan', createdAt: 1, pinned: true })
    db.saveMessage({ id: 'b', agentId: 'planner', role: 'agent', text: 'Other', createdAt: 2 })
    db.saveMessage({ id: 'c', agentId: 'email', role: 'agent', text: 'Mail', createdAt: 3, pinned: true })
    expect(db.pinnedMessages('planner').map((m) => m.id)).toEqual(['a'])
  })
})

describe('repairInterrupted', () => {
  it('fails an approved action left running by a crash, without touching the others', () => {
    const db = new Db(':memory:')
    const action = (id: string, status: 'pending' | 'executing' | 'done') => ({ id, type: 'send_email', summary: id, details: {}, status })
    db.saveMessage({ id: 'm1', agentId: 'email', role: 'agent', text: 'Draft', createdAt: 1, actions: [action('a1', 'executing'), action('a2', 'pending'), action('a3', 'done')] })
    db.repairInterrupted()
    const actions = db.getMessage('m1')?.actions
    expect(actions?.map((a) => a.status)).toEqual(['failed', 'pending', 'done'])
    expect(actions?.[0]?.result).toMatch(/closed while this was running/)
  })
})
