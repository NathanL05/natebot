import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentConfig, ChatMessage, RoomConfig } from '@shared/types'
import type { AgentStore } from './agents'
import type { Db, Seat } from './db'
import type { Engine, RoomTurn, RoomTurnResult } from './engine'
import { Rooms } from './rooms'
import type { UsageTracker } from './usage'

const agent = (id: string, name: string): AgentConfig => ({
  id,
  name,
  shape: null,
  color: '#5E8BFF',
  model: 'haiku',
  effort: 'low',
  instructions: `${name} instructions`,
  mcp_servers: [],
  allowed_tools: [],
  disallowed_tools: [],
  quick_prompts: [],
  routines: [],
  email_triggers: [],
  session_id: null
})

/** What an agent "says" on a turn: reply text ('' = PASS) or a non-ok result. */
type Reply = string | Partial<RoomTurnResult>

class FakeDb {
  messages: ChatMessage[] = []
  rooms = new Map<string, RoomConfig>()
  seatMap = new Map<string, Record<string, Seat>>()
  unreadCount = new Map<string, number>()

  saveMessage(m: ChatMessage): void {
    const i = this.messages.findIndex((x) => x.id === m.id)
    if (i === -1) this.messages.push({ ...m })
    else this.messages[i] = { ...m }
  }
  listMessages(chatId: string, limit = 500): ChatMessage[] {
    return this.messages.filter((m) => m.agentId === chatId).slice(-limit)
  }
  lastMessage(chatId: string): ChatMessage | null {
    return this.listMessages(chatId).filter((m) => m.text).at(-1) ?? null
  }
  unread(chatId: string): number {
    return this.unreadCount.get(chatId) ?? 0
  }
  bumpUnread(chatId: string): void {
    this.unreadCount.set(chatId, this.unread(chatId) + 1)
  }
  folderOf(): string | null {
    return null
  }
  listRooms(): RoomConfig[] {
    return [...this.rooms.values()]
  }
  saveRoom(room: RoomConfig): void {
    this.rooms.set(room.id, room)
  }
  deleteRoom(id: string): void {
    this.rooms.delete(id)
  }
  seats(roomId: string): Record<string, Seat> {
    return { ...this.seatMap.get(roomId) }
  }
  setSeat(roomId: string, agentId: string, seat: Seat | null): void {
    const all = { ...this.seatMap.get(roomId) }
    if (seat) all[agentId] = seat
    else delete all[agentId]
    this.seatMap.set(roomId, all)
  }
}

function setup(opts: { members?: AgentConfig[]; waitMs?: number } = {}) {
  const members = opts.members ?? [agent('a', 'Ann'), agent('b', 'Bob'), agent('c', 'Cat')]
  const byId = new Map(members.map((m) => [m.id, m]))
  const db = new FakeDb()
  const script = new Map<string, Reply[]>()
  const turns: RoomTurn[] = []
  let session = 0
  let idle: (replies: number) => void = () => undefined

  const engine = {
    stopRoom: vi.fn(),
    roomTurn: vi.fn(async (t: RoomTurn): Promise<RoomTurnResult> => {
      turns.push(t)
      // Each turn happens a second later, like a real run.
      vi.setSystemTime(Date.now() + 1000)
      const reply = script.get(t.agent.id)?.shift() ?? `${t.agent.name} here`
      if (typeof reply !== 'string') return { status: 'error', text: '', detail: '', ...reply }
      t.onSession(t.sessionId ?? `session-${++session}`)
      if (reply) {
        db.saveMessage({ id: `m${db.messages.length}`, agentId: t.roomId, speakerId: t.agent.id, role: 'agent', text: reply, createdAt: Date.now() })
      }
      return { status: 'ok', text: reply, detail: '' }
    })
  }
  const emitMessage = vi.fn((m: ChatMessage) => void m)

  const rooms = new Rooms({
    db: db as unknown as Db,
    store: { get: (id: string) => byId.get(id) } as unknown as AgentStore,
    engine: engine as unknown as Engine,
    usage: { waitMs: () => opts.waitMs ?? 0 } as unknown as UsageTracker,
    userName: () => 'Nathan',
    emitMessage,
    emitRooms: vi.fn(),
    onIdle: (_id, replies) => idle(replies)
  })

  /** Posts a user message and waits for the group to go quiet. Returns how many replies were added. */
  const say = (roomId: string, text: string): Promise<number> =>
    new Promise((resolve) => {
      idle = resolve
      rooms.post(roomId, text)
    })

  const speakers = (): string[] => turns.map((t) => t.agent.id)
  const systemLines = (): string[] => db.messages.filter((m) => m.role === 'system').map((m) => m.text)

  return { rooms, db, script, turns, engine, say, speakers, systemLines, emitMessage }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-01T09:00:00Z'))
})
afterEach(() => {
  vi.useRealTimers()
})

describe('creating and editing group chats', () => {
  it('needs at least two real agents', () => {
    const { rooms } = setup()
    expect(() => rooms.create({ name: 'Solo', memberIds: ['a'], maxTurns: 8 })).toThrow(/at least 2/)
    expect(() => rooms.create({ name: 'Ghosts', memberIds: ['a', 'zz', 'a'], maxTurns: 8 })).toThrow(/at least 2/)
  })

  it('dedupes members, names the room after them and clamps the turn budget', () => {
    const { rooms } = setup()
    const room = rooms.create({ name: '  ', memberIds: ['a', 'b', 'a', 'zz'], maxTurns: 99 })
    expect(room.memberIds).toEqual(['a', 'b'])
    expect(room.name).toBe('Ann, Bob')
    expect(room.maxTurns).toBe(30)
    expect(room.id).toMatch(/^room:/)
    expect(rooms.create({ name: 'x', memberIds: ['a', 'b'], maxTurns: 0 }).maxTurns).toBe(1)
    expect(rooms.create({ name: 'x', memberIds: ['a', 'b'], maxTurns: 2.5 }).maxTurns).toBe(8)
  })

  it('gives everyone fresh sessions when the line-up changes', () => {
    const { rooms, db } = setup()
    const room = rooms.create({ name: 'Team', memberIds: ['a', 'b'], maxTurns: 8 })
    db.setSeat(room.id, 'a', { sessionId: 's1', seenAt: 1 })
    db.setSeat(room.id, 'b', { sessionId: 's2', seenAt: 1 })

    rooms.update({ ...room, name: 'Renamed' })
    expect(Object.keys(db.seats(room.id))).toEqual(['a', 'b'])

    rooms.update({ ...room, memberIds: ['a', 'b', 'c'] })
    expect(db.seats(room.id)).toEqual({})
  })

  it('takes a deleted agent out of every room', () => {
    const { rooms } = setup()
    const room = rooms.create({ name: 'Team', memberIds: ['a', 'b', 'c'], maxTurns: 8 })
    rooms.removeMember('b')
    expect(rooms.get(room.id)?.memberIds).toEqual(['a', 'c'])
  })
})

describe('turn order', () => {
  it('lets every member reply once, in order', async () => {
    const { rooms, say, speakers } = setup()
    const room = rooms.create({ name: 'Team', memberIds: ['a', 'b', 'c'], maxTurns: 8 })
    expect(await say(room.id, 'Morning all')).toBe(3)
    expect(speakers()).toEqual(['a', 'b', 'c'])
  })

  it('starts the next round after whoever spoke last', async () => {
    const { rooms, say, speakers, script } = setup()
    const room = rooms.create({ name: 'Team', memberIds: ['a', 'b', 'c'], maxTurns: 8 })
    script.set('c', ['']) // Cat passes, so Bob spoke last
    await say(room.id, 'Round one')
    await say(room.id, 'Round two')
    expect(speakers()).toEqual(['a', 'b', 'c', 'c', 'a', 'b'])
  })

  it('puts @mentioned members first and makes the rest optional', async () => {
    const { rooms, say, turns, speakers } = setup()
    const room = rooms.create({ name: 'Team', memberIds: ['a', 'b', 'c'], maxTurns: 8 })
    await say(room.id, 'What do you think, @Cat and @bob?')
    expect(speakers()).toEqual(['c', 'b', 'a'])
    expect(turns[0]?.input).not.toMatch(/@mentioned someone else/)
    expect(turns[2]?.input).toMatch(/@mentioned someone else, not you/)
  })

  it("doesn't treat a longer name as a mention", async () => {
    const { rooms, say, speakers } = setup({ members: [agent('a', 'Ann'), agent('b', 'Bob'), agent('ann-2', 'Annie')] })
    const room = rooms.create({ name: 'Team', memberIds: ['a', 'b', 'ann-2'], maxTurns: 8 })
    await say(room.id, '@Annie can you start?')
    expect(speakers()[0]).toBe('ann-2')
  })

  it('hands the next turn to an agent that another agent @mentions', async () => {
    const { rooms, say, speakers, script } = setup()
    const room = rooms.create({ name: 'Team', memberIds: ['a', 'b', 'c'], maxTurns: 8 })
    script.set('a', ['@Cat can you check the dates?'])
    await say(room.id, 'Plan the trip')
    expect(speakers()).toEqual(['a', 'c', 'b'])
  })

  it('shows each agent only what it has not seen yet', async () => {
    const { rooms, say, turns } = setup()
    const room = rooms.create({ name: 'Team', memberIds: ['a', 'b'], maxTurns: 8 })
    await say(room.id, 'First')
    await say(room.id, 'Second')
    const annSecondTurn = turns[2]
    expect(annSecondTurn?.agent.id).toBe('a')
    expect(annSecondTurn?.input).toContain('Nathan (user): Second')
    expect(annSecondTurn?.input).not.toContain('Nathan (user): First')
    expect(annSecondTurn?.input).toContain('[New in the group since your last turn]')
  })
})

describe('pacing and stopping', () => {
  it('stops after maxTurns replies and asks the last one to wrap up', async () => {
    const { rooms, say, turns } = setup()
    const room = rooms.create({ name: 'Team', memberIds: ['a', 'b', 'c'], maxTurns: 2 })
    expect(await say(room.id, 'Go')).toBe(2)
    expect(turns).toHaveLength(2)
    expect(turns[1]?.input).toMatch(/last reply/)
  })

  it("doesn't count a PASS as a reply", async () => {
    const { rooms, say, turns, script } = setup()
    const room = rooms.create({ name: 'Team', memberIds: ['a', 'b', 'c'], maxTurns: 2 })
    script.set('a', [''])
    expect(await say(room.id, 'Go')).toBe(2)
    expect(turns.map((t) => t.agent.id)).toEqual(['a', 'b', 'c'])
  })

  it('pauses when the usage limit is reached', async () => {
    const { rooms, say, turns, systemLines } = setup({ waitMs: 60_000 })
    const room = rooms.create({ name: 'Team', memberIds: ['a', 'b'], maxTurns: 8 })
    expect(await say(room.id, 'Go')).toBe(0)
    expect(turns).toHaveLength(0)
    expect(systemLines().at(-1)).toMatch(/Usage limit reached/)
  })

  it('ends the conversation when a run hits the usage limit', async () => {
    const { rooms, say, turns, script, systemLines } = setup()
    const room = rooms.create({ name: 'Team', memberIds: ['a', 'b', 'c'], maxTurns: 8 })
    script.set('b', [{ status: 'limited' }])
    expect(await say(room.id, 'Go')).toBe(1)
    expect(turns.map((t) => t.agent.id)).toEqual(['a', 'b'])
    expect(systemLines().at(-1)).toMatch(/Usage limit reached/)
  })

  it('reports an error and lets the others carry on', async () => {
    const { rooms, say, db, script } = setup()
    const room = rooms.create({ name: 'Team', memberIds: ['a', 'b'], maxTurns: 8 })
    script.set('a', [{ status: 'error', detail: 'boom' }])
    expect(await say(room.id, 'Go')).toBe(1)
    expect(db.messages.find((m) => m.role === 'error')?.text).toBe('Ann: boom')
  })

  it('retries once with a fresh session when the old one is gone', async () => {
    const { rooms, say, turns, db, script } = setup()
    const room = rooms.create({ name: 'Team', memberIds: ['a', 'b'], maxTurns: 1 })
    db.setSeat(room.id, 'a', { sessionId: 'old', seenAt: 0 })
    script.set('a', [{ status: 'session-lost' }, 'Back again'])
    await say(room.id, 'Hello?')
    expect(turns.map((t) => t.sessionId)).toEqual(['old', null])
    expect(db.seats(room.id)['a']?.sessionId).toMatch(/^session-/)
  })

  it('refuses to run a room left with one member', async () => {
    const { rooms, systemLines } = setup()
    const room = rooms.create({ name: 'Team', memberIds: ['a', 'b'], maxTurns: 8 })
    rooms.removeMember('b')
    rooms.post(room.id, 'Anyone?')
    expect(systemLines().at(-1)).toMatch(/needs at least 2 agents/)
  })
})
