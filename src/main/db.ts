// Chat history, per-agent state and run logs in SQLite (~/NateBot/data.db).
// Uses Node's built-in node:sqlite, so there is no native module to rebuild.
import { DatabaseSync } from 'node:sqlite'
import { DELETED_AGENT_ID } from '@shared/usage'
import type { AgentUsage, ChatMessage, Folder, MessageRole, Reminder, ReminderStatus, RoomConfig } from '@shared/types'
import type { RunTokens } from './claude/stream'
import type { Checkpoint } from './scheduler'

interface MessageRow {
  id: string
  agent_id: string
  role: string
  text: string
  created_at: number
  data: string | null
}

/** One agent's place in a group chat: its room-only session and what it has already read. */
export interface Seat {
  sessionId: string | null
  /** createdAt of the newest message the agent has been shown. */
  seenAt: number
}

interface RoomRow {
  id: string
  name: string
  members: string
  max_turns: number
  seats: string
}

export interface RunRecord {
  id: string
  agentId: string
  source: 'chat' | 'routine' | 'action' | 'room' | 'reminder'
  startedAt: number
  endedAt: number | null
  ok: boolean | null
  summary: string | null
}

interface ReminderRow {
  id: string
  agent_id: string
  message_id: string
  at: number
  kind: string
  text: string
  status: string
}

function toReminder(row: ReminderRow): Reminder {
  return {
    id: row.id,
    agentId: row.agent_id,
    messageId: row.message_id,
    at: row.at,
    kind: row.kind === 'task' ? 'task' : 'message',
    text: row.text,
    status: row.status as ReminderStatus
  }
}

function toMessage(row: MessageRow): ChatMessage {
  const extra = row.data ? (JSON.parse(row.data) as Partial<ChatMessage>) : {}
  return {
    id: row.id,
    agentId: row.agent_id,
    role: row.role as MessageRole,
    text: row.text,
    createdAt: row.created_at,
    ...extra
  }
}

export class Db {
  private db: DatabaseSync

  constructor(file: string) {
    this.db = new DatabaseSync(file)
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        role TEXT NOT NULL,
        text TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        data TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_messages_agent ON messages(agent_id, created_at);
      CREATE TABLE IF NOT EXISTS agent_state (
        agent_id TEXT PRIMARY KEY,
        unread INTEGER NOT NULL DEFAULT 0,
        notes TEXT NOT NULL DEFAULT '[]'
      );
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        source TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        ended_at INTEGER,
        ok INTEGER,
        summary TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_runs_agent ON runs(agent_id, source, started_at);
      CREATE INDEX IF NOT EXISTS idx_runs_started ON runs(started_at);
      CREATE TABLE IF NOT EXISTS rooms (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        members TEXT NOT NULL,
        max_turns INTEGER NOT NULL,
        seats TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS reminders (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        at INTEGER NOT NULL,
        kind TEXT NOT NULL,
        text TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_reminders_due ON reminders(status, at);
      CREATE TABLE IF NOT EXISTS folders (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        collapsed INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );
    `)
    // Added after the first release: which sidebar folder a chat is in.
    const cols = this.db.prepare('PRAGMA table_info(agent_state)').all() as { name: string }[]
    if (!cols.some((c) => c.name === 'folder_id')) this.db.exec('ALTER TABLE agent_state ADD COLUMN folder_id TEXT')
    // Added later: up to when an agent's routine times have been dealt with (JSON Checkpoint).
    if (!cols.some((c) => c.name === 'routine_checkpoint')) this.db.exec('ALTER TABLE agent_state ADD COLUMN routine_checkpoint TEXT')
    // Added later: what each run used (null for runs before this, or that never reported).
    const runCols = this.db.prepare('PRAGMA table_info(runs)').all() as { name: string }[]
    for (const col of ['input_tokens', 'cache_write_tokens', 'cache_read_tokens', 'output_tokens']) {
      if (!runCols.some((c) => c.name === col)) this.db.exec(`ALTER TABLE runs ADD COLUMN ${col} INTEGER`)
    }
    if (!runCols.some((c) => c.name === 'cost_usd')) this.db.exec('ALTER TABLE runs ADD COLUMN cost_usd REAL')
  }

  close(): void {
    this.db.close()
  }

  // ---- messages ----

  saveMessage(m: ChatMessage): void {
    const { id, agentId, role, text, createdAt, ...extra } = m
    this.db
      .prepare(
        `INSERT INTO messages (id, agent_id, role, text, created_at, data) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET role = excluded.role, text = excluded.text, data = excluded.data`
      )
      .run(id, agentId, role, text, createdAt, JSON.stringify(extra))
  }

  getMessage(id: string): ChatMessage | null {
    const row = this.db.prepare('SELECT * FROM messages WHERE id = ?').get(id) as MessageRow | undefined
    return row ? toMessage(row) : null
  }

  listMessages(agentId: string, limit = 500): ChatMessage[] {
    const rows = this.db
      .prepare('SELECT * FROM messages WHERE agent_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?')
      .all(agentId, limit) as unknown as MessageRow[]
    return rows.reverse().map(toMessage)
  }

  lastMessage(agentId: string): ChatMessage | null {
    const row = this.db
      .prepare(`SELECT * FROM messages WHERE agent_id = ? AND text != '' ORDER BY created_at DESC, rowid DESC LIMIT 1`)
      .get(agentId) as MessageRow | undefined
    return row ? toMessage(row) : null
  }

  /** Messages left mid-stream by a crash or force-quit. */
  repairInterrupted(): void {
    const rows = this.db.prepare(`SELECT * FROM messages WHERE data LIKE '%"streaming":true%'`).all() as unknown as MessageRow[]
    for (const row of rows) {
      const m = toMessage(row)
      m.streaming = false
      m.tools = m.tools?.map((t) => (t.status === 'running' ? { ...t, status: 'error' } : t))
      m.text = m.text ? `${m.text}\n\n_(interrupted)_` : '_(interrupted when NateBot closed)_'
      this.saveMessage(m)
    }
    this.db.prepare(`UPDATE runs SET ended_at = started_at, ok = 0, summary = 'Interrupted' WHERE ended_at IS NULL`).run()
  }

  // ---- per-agent state ----

  private ensureState(agentId: string): void {
    this.db.prepare('INSERT OR IGNORE INTO agent_state (agent_id) VALUES (?)').run(agentId)
  }

  unread(agentId: string): number {
    const row = this.db.prepare('SELECT unread FROM agent_state WHERE agent_id = ?').get(agentId) as { unread: number } | undefined
    return row?.unread ?? 0
  }

  bumpUnread(agentId: string): void {
    this.ensureState(agentId)
    this.db.prepare('UPDATE agent_state SET unread = unread + 1 WHERE agent_id = ?').run(agentId)
  }

  clearUnread(agentId: string): void {
    this.db.prepare('UPDATE agent_state SET unread = 0 WHERE agent_id = ?').run(agentId)
  }

  /** Notes are passed to the agent with its next prompt (e.g. "your proposed email was sent"). */
  addNote(agentId: string, note: string): void {
    this.ensureState(agentId)
    const notes = this.peekNotes(agentId)
    notes.push(note)
    this.db.prepare('UPDATE agent_state SET notes = ? WHERE agent_id = ?').run(JSON.stringify(notes.slice(-20)), agentId)
  }

  private peekNotes(agentId: string): string[] {
    const row = this.db.prepare('SELECT notes FROM agent_state WHERE agent_id = ?').get(agentId) as { notes: string } | undefined
    try {
      return row ? (JSON.parse(row.notes) as string[]) : []
    } catch {
      return []
    }
  }

  takeNotes(agentId: string): string[] {
    const notes = this.peekNotes(agentId)
    if (notes.length) this.db.prepare(`UPDATE agent_state SET notes = '[]' WHERE agent_id = ?`).run(agentId)
    return notes
  }

  // ---- routine checkpoints ----

  routineCheckpoint(agentId: string): Checkpoint | null {
    const row = this.db.prepare('SELECT routine_checkpoint FROM agent_state WHERE agent_id = ?').get(agentId) as
      | { routine_checkpoint: string | null }
      | undefined
    try {
      const cp = row?.routine_checkpoint ? (JSON.parse(row.routine_checkpoint) as Checkpoint) : null
      return cp && typeof cp.cron === 'string' && typeof cp.at === 'number' ? cp : null
    } catch {
      return null
    }
  }

  setRoutineCheckpoint(agentId: string, cp: Checkpoint | null): void {
    this.ensureState(agentId)
    this.db.prepare('UPDATE agent_state SET routine_checkpoint = ? WHERE agent_id = ?').run(cp ? JSON.stringify(cp) : null, agentId)
  }

  // ---- runs ----

  startRun(id: string, agentId: string, source: RunRecord['source']): void {
    this.db.prepare('INSERT INTO runs (id, agent_id, source, started_at) VALUES (?, ?, ?, ?)').run(id, agentId, source, Date.now())
  }

  finishRun(id: string, ok: boolean, summary: string, tokens: RunTokens | null = null): void {
    this.db
      .prepare(
        `UPDATE runs SET ended_at = ?, ok = ?, summary = ?, input_tokens = ?, cache_write_tokens = ?,
         cache_read_tokens = ?, output_tokens = ?, cost_usd = ? WHERE id = ?`
      )
      .run(
        Date.now(),
        ok ? 1 : 0,
        summary.slice(0, 300),
        tokens?.input ?? null,
        tokens?.cacheWrite ?? null,
        tokens?.cacheRead ?? null,
        tokens?.output ?? null,
        tokens?.costUsd ?? null,
        id
      )
  }

  /** Per-agent totals for runs started since `since` (every kind: chat, routine, action, group chat). */
  usageByAgent(since: number): AgentUsage[] {
    const rows = this.db
      .prepare(
        `SELECT agent_id, COUNT(*) AS runs,
           COALESCE(SUM(input_tokens + cache_write_tokens + cache_read_tokens), 0) AS input,
           COALESCE(SUM(output_tokens), 0) AS output,
           COALESCE(SUM(cost_usd), 0) AS cost,
           SUM(CASE WHEN input_tokens IS NULL THEN 1 ELSE 0 END) AS unmeasured
         FROM runs WHERE started_at >= ? AND ended_at IS NOT NULL GROUP BY agent_id`
      )
      .all(since) as { agent_id: string; runs: number; input: number; output: number; cost: number; unmeasured: number }[]
    return rows.map((r) => ({
      agentId: r.agent_id,
      runs: r.runs,
      inputTokens: r.input,
      outputTokens: r.output,
      costUsd: r.cost,
      unmeasuredRuns: r.unmeasured
    }))
  }

  lastRun(agentId: string, source: RunRecord['source']): RunRecord | null {
    const row = this.db
      .prepare('SELECT * FROM runs WHERE agent_id = ? AND source = ? AND ended_at IS NOT NULL ORDER BY started_at DESC LIMIT 1')
      .get(agentId, source) as
      | { id: string; agent_id: string; source: string; started_at: number; ended_at: number | null; ok: number | null; summary: string | null }
      | undefined
    if (!row) return null
    return {
      id: row.id,
      agentId: row.agent_id,
      source: row.source as RunRecord['source'],
      startedAt: row.started_at,
      endedAt: row.ended_at,
      ok: row.ok === null ? null : row.ok === 1,
      summary: row.summary
    }
  }

  // ---- reminders ----

  saveReminder(r: Reminder): void {
    this.db
      .prepare(
        `INSERT INTO reminders (id, agent_id, message_id, at, kind, text, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET status = excluded.status`
      )
      .run(r.id, r.agentId, r.messageId, r.at, r.kind, r.text, r.status, Date.now())
  }

  reminder(id: string): Reminder | null {
    const row = this.db.prepare('SELECT * FROM reminders WHERE id = ?').get(id) as ReminderRow | undefined
    return row ? toReminder(row) : null
  }

  setReminderStatus(id: string, status: ReminderStatus): void {
    this.db.prepare('UPDATE reminders SET status = ? WHERE id = ?').run(status, id)
  }

  /** Scheduled reminders, soonest first; only those due by `until` when given. */
  scheduledReminders(until = Number.MAX_SAFE_INTEGER): Reminder[] {
    const rows = this.db
      .prepare(`SELECT * FROM reminders WHERE status = 'scheduled' AND at <= ? ORDER BY at`)
      .all(until) as unknown as ReminderRow[]
    return rows.map(toReminder)
  }

  nextReminderAt(): number | null {
    const row = this.db.prepare(`SELECT MIN(at) AS at FROM reminders WHERE status = 'scheduled'`).get() as { at: number | null }
    return row.at ?? null
  }

  scheduledCount(agentId: string): number {
    const row = this.db.prepare(`SELECT COUNT(*) AS n FROM reminders WHERE status = 'scheduled' AND agent_id = ?`).get(agentId) as { n: number }
    return row.n
  }

  deleteAgent(agentId: string): void {
    this.db.prepare('DELETE FROM messages WHERE agent_id = ?').run(agentId)
    this.db.prepare('DELETE FROM reminders WHERE agent_id = ?').run(agentId)
    this.db.prepare('DELETE FROM agent_state WHERE agent_id = ?').run(agentId)
    // Keep what the agent used, so usage totals don't shift onto the others.
    this.db.prepare('UPDATE runs SET agent_id = ? WHERE agent_id = ?').run(DELETED_AGENT_ID, agentId)
  }

  // ---- sidebar folders ----

  listFolders(): Folder[] {
    const rows = this.db.prepare('SELECT * FROM folders ORDER BY created_at').all() as unknown as {
      id: string
      name: string
      collapsed: number
    }[]
    return rows.map((r) => ({ id: r.id, name: r.name, collapsed: r.collapsed === 1 }))
  }

  saveFolder(f: Folder): void {
    this.db
      .prepare(
        `INSERT INTO folders (id, name, collapsed, created_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, collapsed = excluded.collapsed`
      )
      .run(f.id, f.name, f.collapsed ? 1 : 0, Date.now())
  }

  deleteFolder(id: string): void {
    this.db.prepare('DELETE FROM folders WHERE id = ?').run(id)
    this.db.prepare('UPDATE agent_state SET folder_id = NULL WHERE folder_id = ?').run(id)
  }

  /** chatId: an agent or group chat. */
  folderOf(chatId: string): string | null {
    const row = this.db.prepare('SELECT folder_id FROM agent_state WHERE agent_id = ?').get(chatId) as { folder_id: string | null } | undefined
    return row?.folder_id ?? null
  }

  setFolder(chatId: string, folderId: string | null): void {
    this.ensureState(chatId)
    this.db.prepare('UPDATE agent_state SET folder_id = ? WHERE agent_id = ?').run(folderId, chatId)
  }

  // ---- group chats ----

  listRooms(): RoomConfig[] {
    const rows = this.db.prepare('SELECT * FROM rooms ORDER BY created_at').all() as unknown as RoomRow[]
    return rows.map((r) => ({ id: r.id, name: r.name, memberIds: JSON.parse(r.members) as string[], maxTurns: r.max_turns }))
  }

  saveRoom(room: RoomConfig): void {
    this.db
      .prepare(
        `INSERT INTO rooms (id, name, members, max_turns, created_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, members = excluded.members, max_turns = excluded.max_turns`
      )
      .run(room.id, room.name, JSON.stringify(room.memberIds), room.maxTurns, Date.now())
  }

  seats(roomId: string): Record<string, Seat> {
    const row = this.db.prepare('SELECT seats FROM rooms WHERE id = ?').get(roomId) as { seats: string } | undefined
    try {
      return row ? (JSON.parse(row.seats) as Record<string, Seat>) : {}
    } catch {
      return {}
    }
  }

  setSeat(roomId: string, agentId: string, seat: Seat | null): void {
    const seats = this.seats(roomId)
    if (seat) seats[agentId] = seat
    else delete seats[agentId]
    this.db.prepare('UPDATE rooms SET seats = ? WHERE id = ?').run(JSON.stringify(seats), roomId)
  }

  deleteRoom(roomId: string): void {
    this.db.prepare('DELETE FROM rooms WHERE id = ?').run(roomId)
    // Its messages and unread count are keyed by the room id, like an agent's.
    this.deleteAgent(roomId)
  }
}
