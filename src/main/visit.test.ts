import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '@shared/types'
import { Db } from './db'
import { AWAY_MS, previewText, returnVisit, startupVisit, summarizeVisit } from './visit'

const H = 3_600_000
const NOW = 1_800_000_000_000

const msg = (id: string, agentId: string, role: ChatMessage['role'], text: string, createdAt: number): ChatMessage => ({ id, agentId, role, text, createdAt })
const none = { approvals: 0, radar: 0, due: 0 }

describe('startupVisit', () => {
  it('covers the time since you last looked, and notes a quit after that', () => {
    expect(startupVisit(NOW - 20 * H, NOW - 19 * H, null, NOW)).toEqual({ from: NOW - 20 * H, to: null, closed: { at: NOW - 19 * H, until: NOW } })
  })

  it('ignores a quit from before you last looked (a crash since then wrote none)', () => {
    expect(startupVisit(NOW - 5 * H, NOW - 30 * H, null, NOW)?.closed).toBeNull()
  })

  it('falls back to your last message on the first launch, and skips a short absence', () => {
    expect(startupVisit(null, null, NOW - 3 * H, NOW)?.from).toBe(NOW - 3 * H)
    expect(startupVisit(null, null, null, NOW)).toBeNull()
    expect(startupVisit(NOW - AWAY_MS + 1000, NOW - 1000, null, NOW)).toBeNull()
  })
})

describe('returnVisit', () => {
  it('ends the startup visit at the first look, even hours after a hidden start', () => {
    const start = startupVisit(NOW - 30 * H, null, null, NOW - 6 * H)
    expect(returnVisit(start, NOW - 30 * H, NOW)).toEqual({ from: NOW - 30 * H, to: NOW, closed: null })
  })

  it('starts a new visit only after an hour or more away', () => {
    const seen = { from: NOW - 10 * H, to: NOW - 9 * H, closed: null }
    expect(returnVisit(seen, NOW - 20 * 60_000, NOW)).toBeNull()
    expect(returnVisit(seen, NOW - 2 * H, NOW)).toEqual({ from: NOW - 2 * H, to: NOW, closed: null })
    expect(returnVisit(null, null, NOW)).toBeNull()
  })
})

describe('summarizeVisit', () => {
  const visit = { from: NOW - 10 * H, to: NOW, closed: null }

  it('groups by chat, latest first, preferring what an agent said over a NateBot line', () => {
    const s = summarizeVisit(
      visit,
      [
        msg('a1', 'email-agent', 'agent', '**Two** emails need you', NOW - 3 * H),
        msg('a2', 'email-agent', 'system', 'Routine ran at 7:30 PM', NOW - 3 * H + 1),
        msg('b1', 'straight-talk', 'agent', 'Weekly 1:1', NOW - 1 * H),
        msg('b2', 'straight-talk', 'agent', '', NOW - 1 * H + 5)
      ],
      { approvals: 2, radar: 1, due: 0 }
    )
    expect(s.chats).toEqual([
      { chatId: 'straight-talk', count: 1, messageId: 'b1', text: 'Weekly 1:1', at: NOW - 1 * H },
      { chatId: 'email-agent', count: 2, messageId: 'a1', text: 'Two emails need you', at: NOW - 3 * H + 1 }
    ])
    expect(s).toMatchObject({ since: NOW - 10 * H, closedAt: null, startedAt: null, approvals: 2, radar: 1 })
  })

  it('leaves out replies still being written', () => {
    expect(summarizeVisit(visit, [{ ...msg('a', 'x', 'agent', 'Thinking', NOW - H), streaming: true }], none).chats).toEqual([])
  })
})

describe('previewText', () => {
  it('drops markdown and code, and cuts long text', () => {
    expect(previewText('# Inbox\n\n- **Bank**: [statement](https://x.y)\n```js\nx()\n```')).toBe('Inbox Bank: statement')
    expect(previewText('Two things:\n- ✓ Sam: yes by tonight\n2. Dentist')).toBe('Two things: ✓ Sam: yes by tonight Dentist')
    expect(previewText('word '.repeat(80)).length).toBeLessThanOrEqual(160)
  })
})

describe('Db visit queries', () => {
  it('lists agent and NateBot messages in a window, and keeps numbers in meta', () => {
    const db = new Db(':memory:')
    db.saveMessage(msg('u', 'a', 'user', 'hi', NOW - 5 * H))
    db.saveMessage(msg('x', 'a', 'agent', 'early', NOW - 11 * H))
    db.saveMessage(msg('y', 'a', 'agent', 'in', NOW - 2 * H))
    db.saveMessage(msg('z', 'b', 'system', 'also in', NOW - H))
    db.saveMessage(msg('w', 'b', 'agent', 'after', NOW + H))
    expect(db.messagesBetween(NOW - 10 * H, NOW).map((m) => m.id)).toEqual(['z', 'y'])
    expect(db.lastUserMessageAt()).toBe(NOW - 5 * H)
    expect(db.metaNumber('last_seen')).toBeNull()
    db.setMetaNumber('last_seen', NOW)
    expect(db.metaNumber('last_seen')).toBe(NOW)
    db.setMetaNumber('last_seen', null)
    expect(db.metaNumber('last_seen')).toBeNull()
    db.close()
  })
})
