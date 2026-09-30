// Group chats: the user plus several agents in one conversation. A room runs
// one agent at a time. Each agent sees what was said since its last turn (in
// its own room-only session, so its one-on-one memory stays separate) and can
// hand the conversation to another member with an @mention.
//
// Turn order after a user message: the agents it @mentions, otherwise every
// member once. An @mention in an agent's reply moves that agent to the front.
// The room stops when nobody is left to speak or after maxTurns replies.
import { randomUUID } from 'node:crypto'
import type { AgentConfig, ChatMessage, RoomConfig, RoomDraft, RoomSummary } from '@shared/types'
import { ROOM_PREFIX } from '@shared/types'
import type { AgentStore } from './agents'
import type { Db, Seat } from './db'
import type { Engine, RoomTurnResult } from './engine'
import { currentTimeLine } from './claude/prompt'
import type { UsageTracker } from './usage'

export const MIN_MEMBERS = 2
export const MAX_MEMBERS = 6
const TURN_LIMITS = { min: 1, max: 30, fallback: 8 }
/** How much earlier conversation an agent sees when it first joins. */
const JOIN_HISTORY = 40

interface Live {
  /** Who speaks next, in order. The user and agents' @mentions reorder it. */
  queue: string[]
  turns: number
  speaking: string | null
  stopped: boolean
}

export interface RoomDeps {
  db: Db
  store: AgentStore
  engine: Engine
  usage: UsageTracker
  userName: () => string
  emitMessage: (m: ChatMessage) => void
  emitRooms: () => void
  /** A conversation ended; `replies` agent messages were added. */
  onIdle: (roomId: string, replies: number) => void
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const preview = (text: string): string =>
  (text.split('\n').find((l) => l.trim()) ?? '').replace(/[*_`#>]/g, '').trim().slice(0, 140)

export class Rooms {
  private rooms = new Map<string, RoomConfig>()
  private live = new Map<string, Live>()

  constructor(private deps: RoomDeps) {
    for (const r of deps.db.listRooms()) this.rooms.set(r.id, r)
  }

  get(id: string): RoomConfig | undefined {
    return this.rooms.get(id)
  }

  require(id: unknown): RoomConfig {
    const room = typeof id === 'string' ? this.rooms.get(id) : undefined
    if (!room) throw new Error(`Unknown group chat: ${String(id)}`)
    return room
  }

  summaries(): RoomSummary[] {
    return [...this.rooms.values()].map((r) => {
      const last = this.deps.db.lastMessage(r.id)
      const live = this.live.get(r.id)
      const speaker = last?.speakerId ? this.deps.store.get(last.speakerId)?.name : last?.role === 'user' ? 'You' : null
      return {
        ...r,
        status: live ? 'running' : 'idle',
        speakingId: live?.speaking ?? null,
        unread: this.deps.db.unread(r.id),
        lastActivity: last?.createdAt ?? 0,
        lastPreview: last ? `${speaker ? `${speaker}: ` : ''}${preview(last.text)}` : ''
      }
    })
  }

  // ---- editing ----

  private normalize(draft: RoomDraft, id: string): RoomConfig {
    const name = typeof draft?.name === 'string' ? draft.name.trim().slice(0, 60) : ''
    const ids = Array.isArray(draft?.memberIds) ? draft.memberIds.filter((m) => typeof m === 'string') : []
    const memberIds = [...new Set(ids)].filter((m) => this.deps.store.get(m)).slice(0, MAX_MEMBERS)
    if (memberIds.length < MIN_MEMBERS) throw new Error(`A group chat needs at least ${MIN_MEMBERS} agents.`)
    const turns = Number.isInteger(draft.maxTurns) ? draft.maxTurns : TURN_LIMITS.fallback
    return {
      id,
      name: name || memberIds.map((m) => this.deps.store.get(m)?.name).join(', '),
      memberIds,
      maxTurns: Math.min(TURN_LIMITS.max, Math.max(TURN_LIMITS.min, turns))
    }
  }

  create(draft: RoomDraft): RoomConfig {
    const room = this.normalize(draft, `${ROOM_PREFIX}${randomUUID().slice(0, 8)}`)
    this.rooms.set(room.id, room)
    this.deps.db.saveRoom(room)
    this.system(room.id, `Created group chat with ${this.names(room.memberIds)}`)
    this.deps.emitRooms()
    return room
  }

  update(next: RoomConfig): RoomConfig {
    const before = this.require(next?.id)
    const room = this.normalize(next, before.id)
    this.rooms.set(room.id, room)
    this.deps.db.saveRoom(room)
    const added = room.memberIds.filter((m) => !before.memberIds.includes(m))
    const removed = before.memberIds.filter((m) => !room.memberIds.includes(m))
    if (added.length) this.system(room.id, `${this.names(added)} joined`)
    if (removed.length) this.system(room.id, `${this.names(removed)} left`)
    // Everyone's room prompt lists the members, so a new line-up needs fresh sessions.
    if (added.length || removed.length) {
      for (const m of before.memberIds) this.deps.db.setSeat(room.id, m, null)
    }
    this.deps.emitRooms()
    return room
  }

  delete(id: string): void {
    this.require(id)
    this.stop(id)
    this.rooms.delete(id)
    this.deps.db.deleteRoom(id)
    this.deps.emitRooms()
  }

  /** An agent was deleted: take it out of every room (rooms left with one member are kept but can't run). */
  removeMember(agentId: string): void {
    for (const room of this.rooms.values()) {
      if (!room.memberIds.includes(agentId)) continue
      const next = { ...room, memberIds: room.memberIds.filter((m) => m !== agentId) }
      this.rooms.set(room.id, next)
      this.deps.db.saveRoom(next)
      this.deps.db.setSeat(room.id, agentId, null)
      const live = this.live.get(room.id)
      if (live) live.queue = live.queue.filter((m) => m !== agentId)
    }
    this.deps.emitRooms()
  }

  // ---- conversation ----

  post(roomId: string, text: string): void {
    const room = this.require(roomId)
    const msg: ChatMessage = { id: randomUUID(), agentId: roomId, role: 'user', text, createdAt: Date.now() }
    this.deps.db.saveMessage(msg)
    this.deps.emitMessage(msg)
    const mentioned = this.mentions(room, text)
    this.schedule(room, mentioned.length ? mentioned : this.rotation(room))
  }

  /** Let the agents keep talking without a new user message. */
  resume(roomId: string): void {
    const room = this.require(roomId)
    this.schedule(room, this.rotation(room))
  }

  stop(roomId: string): void {
    const live = this.live.get(roomId)
    if (!live) return
    live.stopped = true
    live.queue = []
    this.deps.engine.stopRoom(roomId)
  }

  shutdown(): void {
    for (const id of this.live.keys()) this.stop(id)
  }

  /** Puts these members next in line (starting the conversation if it's idle) and resets the turn budget. */
  private schedule(room: RoomConfig, queue: string[]): void {
    const live = this.live.get(room.id)
    if (live) {
      live.queue = [...queue, ...live.queue.filter((m) => !queue.includes(m))]
      live.turns = 0
      return
    }
    if (room.memberIds.filter((m) => this.deps.store.get(m)).length < MIN_MEMBERS) {
      this.system(room.id, `This group chat needs at least ${MIN_MEMBERS} agents. Add some in its settings.`)
      return
    }
    const fresh: Live = { queue, turns: 0, speaking: null, stopped: false }
    this.live.set(room.id, fresh)
    void this.converse(room.id, fresh)
  }

  private async converse(roomId: string, live: Live): Promise<void> {
    let replies = 0
    this.deps.emitRooms()
    try {
      while (!live.stopped) {
        const room = this.rooms.get(roomId)
        if (!room) break
        if (live.turns >= room.maxTurns) {
          if (live.queue.length) this.system(roomId, `Paused after ${live.turns} replies. Send a message or press Keep going.`)
          break
        }
        const agentId = live.queue.shift()
        if (!agentId) break
        const agent = this.deps.store.get(agentId)
        if (!agent || !room.memberIds.includes(agentId)) continue
        if (this.deps.usage.waitMs() > 0) {
          this.system(roomId, 'Usage limit reached. The group will carry on when you send a message after it resets.')
          break
        }

        live.speaking = agentId
        this.deps.emitRooms()
        const res = await this.turn(room, agent)
        live.speaking = null

        if (res.status === 'stopped') {
          this.system(roomId, 'Stopped')
          break
        }
        if (res.status === 'limited') {
          this.system(roomId, 'Usage limit reached. The group will carry on when you send a message after it resets.')
          break
        }
        if (res.status !== 'ok') {
          this.error(roomId, `${agent.name}: ${res.detail}`)
          continue
        }
        if (!res.text) continue
        live.turns++
        replies++
        this.deps.db.bumpUnread(roomId)
        // Agents they @mention answer next.
        const mentioned = this.mentions(room, res.text).filter((m) => m !== agentId)
        live.queue = [...mentioned, ...live.queue.filter((m) => !mentioned.includes(m))]
        this.deps.emitRooms()
      }
    } finally {
      this.live.delete(roomId)
      this.deps.emitRooms()
      this.deps.onIdle(roomId, replies)
    }
  }

  /** Runs one agent's turn, starting a fresh room session if the old one is gone. */
  private async turn(room: RoomConfig, agent: AgentConfig): Promise<RoomTurnResult> {
    for (let attempt = 0; ; attempt++) {
      const seat: Seat = this.deps.db.seats(room.id)[agent.id] ?? { sessionId: null, seenAt: 0 }
      const shown = this.unseen(room, agent, seat)
      const seenAt = shown.at(-1)?.createdAt ?? seat.seenAt
      let sessionId = seat.sessionId
      const res = await this.deps.engine.roomTurn({
        roomId: room.id,
        agent,
        sessionId,
        roomPrompt: this.prompt(room, agent),
        input: this.input(room, agent, shown, !seat.sessionId),
        onSession: (id) => {
          sessionId = id
          this.deps.db.setSeat(room.id, agent.id, { sessionId: id, seenAt: seat.seenAt })
        }
      })
      if (res.status === 'session-lost' && attempt === 0) {
        this.deps.db.setSeat(room.id, agent.id, null)
        continue
      }
      if (res.status === 'ok') this.deps.db.setSeat(room.id, agent.id, { sessionId, seenAt })
      return res
    }
  }

  // ---- prompts ----

  /** Messages the agent hasn't been shown yet (everything recent if it's new to the room). */
  private unseen(room: RoomConfig, agent: AgentConfig, seat: Seat): ChatMessage[] {
    return this.deps.db
      .listMessages(room.id, JOIN_HISTORY)
      .filter((m) => m.createdAt > seat.seenAt && m.speakerId !== agent.id && !m.streaming)
      .filter((m) => (m.role === 'user' || m.role === 'agent') && m.text)
  }

  private input(room: RoomConfig, agent: AgentConfig, shown: ChatMessage[], joining: boolean): string {
    const user = this.deps.userName() || 'The user'
    const lines = shown.map((m) => {
      const who = m.role === 'user' ? `${user} (user)` : (this.deps.store.get(m.speakerId ?? '')?.name ?? 'A former member')
      return `${who}: ${m.text}`
    })
    return [
      currentTimeLine(),
      joining ? `[Group chat "${room.name}": the conversation so far]` : '[New in the group since your last turn]',
      lines.join('\n\n') || '(nothing new)',
      `[Your turn, ${agent.name}. Reply to the group, or reply PASS if you have nothing to add.]`
    ].join('\n\n')
  }

  /** Appended to the agent's own system prompt. Stable for a given line-up, so the prompt cache holds. */
  private prompt(room: RoomConfig, agent: AgentConfig): string {
    const user = this.deps.userName() || 'the user'
    const others = room.memberIds
      .filter((m) => m !== agent.id)
      .map((m) => this.deps.store.get(m))
      .filter((a): a is AgentConfig => !!a)
    return `GROUP CHAT MODE. Right now you're in a NateBot group chat called "${room.name}" with ${user} (the user) and these other agents:
${others.map((a) => `- ${a.name}: ${preview(a.instructions) || 'a general assistant'}`).join('\n')}

How the group chat works:
- Each message you get shows what was said since your last turn, as "Name: message". Reply only as yourself with your own message: never write lines for other members and don't start with your name.
- Talk like a group chat: short (1–4 sentences unless asked for more), direct, in character for your role. Build on, question or disagree with what others said instead of repeating it.
- To ask another agent something directly, @mention them by name (e.g. @${others[0]?.name ?? 'Name'}). They reply next.
- If you have nothing useful to add, reply with exactly PASS and nothing else.
- The proposed_actions block isn't available here. If something needs approval, tell ${user} to ask you in your one-on-one chat.`
  }

  // ---- helpers ----

  /** Members @mentioned in the text, in the order they appear. */
  private mentions(room: RoomConfig, text: string): string[] {
    const hits: { id: string; at: number }[] = []
    for (const id of room.memberIds) {
      const name = this.deps.store.get(id)?.name
      if (!name) continue
      const m = new RegExp(`@(?:${escapeRe(name)}|${escapeRe(id)})(?![\\w-])`, 'i').exec(text)
      if (m) hits.push({ id, at: m.index })
    }
    return hits.sort((a, b) => a.at - b.at).map((h) => h.id)
  }

  /** Every member once, starting after whoever spoke last, so the same agent doesn't always open. */
  private rotation(room: RoomConfig): string[] {
    const last = this.deps.db.listMessages(room.id, 30).reverse().find((m) => m.speakerId)?.speakerId
    const i = last ? room.memberIds.indexOf(last) : -1
    return [...room.memberIds.slice(i + 1), ...room.memberIds.slice(0, i + 1)]
  }

  private names(ids: string[]): string {
    return ids.map((m) => this.deps.store.get(m)?.name ?? m).join(', ')
  }

  private system(roomId: string, text: string): void {
    const msg: ChatMessage = { id: randomUUID(), agentId: roomId, role: 'system', text, createdAt: Date.now() }
    this.deps.db.saveMessage(msg)
    this.deps.emitMessage(msg)
  }

  private error(roomId: string, text: string): void {
    const msg: ChatMessage = { id: randomUUID(), agentId: roomId, role: 'error', text, createdAt: Date.now() }
    this.deps.db.saveMessage(msg)
    this.deps.emitMessage(msg)
  }
}
