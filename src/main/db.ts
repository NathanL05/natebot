// Chat history, per-agent state and run logs in SQLite (~/NateBot/data.db).
// Uses Node's built-in node:sqlite, so there is no native module to rebuild.
import { DatabaseSync } from 'node:sqlite'
import { DELETED_AGENT_ID } from '@shared/usage'
import type { AgentUsage, ChatMessage, Folder, Job, JobStatus, MessageHit, MessageRole, Reminder, ReminderStatus, RoomConfig } from '@shared/types'
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
  source: 'chat' | 'routine' | 'action' | 'room' | 'reminder' | 'trigger'
  startedAt: number
  endedAt: number | null
  ok: boolean | null
  summary: string | null
}

/** Marks a trigger as started (kept forever, unlike the per-message rows). */
export const TRIGGER_START = '__start__'

interface JobRow {
  id: string
  company: string
  role: string
  status: string
  deadline: string | null
  link: string | null
  notes: string
  agent_id: string
  created_at: number
  updated_at: number
}

function toJob(r: JobRow): Job {
  return {
    id: r.id,
    company: r.company,
    role: r.role,
    status: r.status as JobStatus,
    deadline: r.deadline,
    link: r.link,
    notes: r.notes,
    agentId: r.agent_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  }
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

/** About a line of text around the first match, without Markdown symbols. */
export function snippetOf(text: string, query: string): string {
  const flat = text.replace(/[*_`#>]/g, '').replace(/\s+/g, ' ').trim()
  const at = flat.toLowerCase().indexOf(query.toLowerCase())
  if (at === -1) return flat.slice(0, 120)
  const start = Math.max(0, at - 40)
  const end = Math.min(flat.length, at + query.length + 80)
  return `${start > 0 ? '…' : ''}${flat.slice(start, end)}${end < flat.length ? '…' : ''}`
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
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        key TEXT NOT NULL UNIQUE,
        company TEXT NOT NULL,
        role TEXT NOT NULL,
        status TEXT NOT NULL,
        deadline TEXT,
        link TEXT,
        notes TEXT NOT NULL DEFAULT '',
        agent_id TEXT NOT NULL,
        reminder_ids TEXT NOT NULL DEFAULT '[]',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS trigger_seen (
        trigger_key TEXT NOT NULL,
        message_id TEXT NOT NULL,
        seen_at INTEGER NOT NULL,
        PRIMARY KEY (trigger_key, message_id)
      );
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
    // Added later: which of the agent's routines a routine run was (null before: the "main" one).
    if (!runCols.some((c) => c.name === 'routine_id')) this.db.exec('ALTER TABLE runs ADD COLUMN routine_id TEXT')
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

  /** Your messages and agents' replies containing `query` (case-insensitive), newest first. */
  searchMessages(query: string, limit = 40): MessageHit[] {
    const q = query.trim()
    if (!q) return []
    const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
    const rows = this.db
      .prepare(
        `SELECT * FROM messages WHERE role IN ('user', 'agent') AND text LIKE ? ESCAPE '\\'
         ORDER BY created_at DESC, rowid DESC LIMIT ?`
      )
      .all(like, limit) as unknown as MessageRow[]
    return rows.map((row) => {
      const m = toMessage(row)
      return { messageId: m.id, chatId: m.agentId, role: m.role as 'user' | 'agent', speakerId: m.speakerId, snippet: snippetOf(m.text, q), createdAt: m.createdAt }
    })
  }

  /** Agent messages with a proposed action or handoff still waiting for the user, newest first. */
  pendingMessages(): ChatMessage[] {
    const rows = this.db
      .prepare(`SELECT * FROM messages WHERE role = 'agent' AND data LIKE '%"status":"pending"%' ORDER BY created_at DESC LIMIT 100`)
      .all() as unknown as MessageRow[]
    return rows.map(toMessage).filter((m) => m.actions?.some((a) => a.status === 'pending') || m.handoffs?.some((h) => h.status === 'pending'))
  }

  /** The agent's latest non-empty reply, for runs that start without the chat's session. */
  lastAgentText(agentId: string): string | null {
    const row = this.db
      .prepare(`SELECT text FROM messages WHERE agent_id = ? AND role = 'agent' AND text != '' ORDER BY created_at DESC, rowid DESC LIMIT 1`)
      .get(agentId) as { text: string } | undefined
    return row?.text ?? null
  }

  /** The last few messages of a chat, oldest first, for carrying context into a fresh session. */
  recentTurns(agentId: string, count = 6): ChatMessage[] {
    return this.listMessages(agentId, 40)
      .filter((m) => (m.role === 'user' || m.role === 'agent') && m.text)
      .slice(-count)
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

  peekNotes(agentId: string): string[] {
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

  /** By routine id. Older databases hold a single checkpoint, which belonged to the "main" routine. */
  routineCheckpoints(agentId: string): Record<string, Checkpoint> {
    const row = this.db.prepare('SELECT routine_checkpoint FROM agent_state WHERE agent_id = ?').get(agentId) as
      | { routine_checkpoint: string | null }
      | undefined
    const valid = (cp: unknown): cp is Checkpoint =>
      !!cp && typeof (cp as Checkpoint).cron === 'string' && typeof (cp as Checkpoint).at === 'number'
    try {
      const raw = row?.routine_checkpoint ? (JSON.parse(row.routine_checkpoint) as unknown) : null
      if (valid(raw)) return { main: raw }
      if (!raw || typeof raw !== 'object') return {}
      return Object.fromEntries(Object.entries(raw).filter(([, cp]) => valid(cp))) as Record<string, Checkpoint>
    } catch {
      return {}
    }
  }

  setRoutineCheckpoints(agentId: string, cps: Record<string, Checkpoint>): void {
    this.ensureState(agentId)
    const json = Object.keys(cps).length ? JSON.stringify(cps) : null
    this.db.prepare('UPDATE agent_state SET routine_checkpoint = ? WHERE agent_id = ?').run(json, agentId)
  }

  // ---- runs ----

  startRun(id: string, agentId: string, source: RunRecord['source'], routineId: string | null = null): void {
    this.db
      .prepare('INSERT INTO runs (id, agent_id, source, started_at, routine_id) VALUES (?, ?, ?, ?, ?)')
      .run(id, agentId, source, Date.now(), routineId)
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

  /** The latest finished run of a kind; for routines, of one routine. */
  lastRun(agentId: string, source: RunRecord['source'], routineId?: string): RunRecord | null {
    const row = (
      routineId === undefined
        ? this.db
            .prepare('SELECT * FROM runs WHERE agent_id = ? AND source = ? AND ended_at IS NOT NULL ORDER BY started_at DESC LIMIT 1')
            .get(agentId, source)
        : this.db
            .prepare(
              `SELECT * FROM runs WHERE agent_id = ? AND source = ? AND ended_at IS NOT NULL
               AND (routine_id = ? OR (routine_id IS NULL AND ? = 'main')) ORDER BY started_at DESC LIMIT 1`
            )
            .get(agentId, source, routineId, routineId)
    ) as
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

  // ---- job tracker ----

  listJobs(): Job[] {
    const rows = this.db.prepare('SELECT * FROM jobs ORDER BY updated_at DESC').all() as unknown as JobRow[]
    return rows.map(toJob)
  }

  job(id: string): Job | null {
    const row = this.db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as JobRow | undefined
    return row ? toJob(row) : null
  }

  jobByKey(key: string): Job | null {
    const row = this.db.prepare('SELECT * FROM jobs WHERE key = ?').get(key) as JobRow | undefined
    return row ? toJob(row) : null
  }

  saveJob(j: Job, key: string): void {
    this.db
      .prepare(
        `INSERT INTO jobs (id, key, company, role, status, deadline, link, notes, agent_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET key = excluded.key, company = excluded.company, role = excluded.role, status = excluded.status,
           deadline = excluded.deadline, link = excluded.link, notes = excluded.notes, updated_at = excluded.updated_at`
      )
      .run(j.id, key, j.company, j.role, j.status, j.deadline, j.link, j.notes, j.agentId, j.createdAt, j.updatedAt)
  }

  jobReminders(id: string): string[] {
    const row = this.db.prepare('SELECT reminder_ids FROM jobs WHERE id = ?').get(id) as { reminder_ids: string } | undefined
    try {
      return row ? (JSON.parse(row.reminder_ids) as string[]) : []
    } catch {
      return []
    }
  }

  setJobReminders(id: string, ids: string[]): void {
    this.db.prepare('UPDATE jobs SET reminder_ids = ? WHERE id = ?').run(JSON.stringify(ids), id)
  }

  deleteJob(id: string): void {
    this.db.prepare('DELETE FROM jobs WHERE id = ?').run(id)
  }

  // ---- email triggers ----

  /** Of these Gmail message ids, the ones this trigger hasn't seen; all of them are marked seen. */
  unseenEmails(triggerKey: string, ids: string[]): string[] {
    const fresh: string[] = []
    const insert = this.db.prepare('INSERT OR IGNORE INTO trigger_seen (trigger_key, message_id, seen_at) VALUES (?, ?, ?)')
    for (const id of ids) if (insert.run(triggerKey, id, Date.now()).changes > 0) fresh.push(id)
    // Old entries are only needed while Gmail still returns those messages (the search covers 2 days).
    this.db.prepare(`DELETE FROM trigger_seen WHERE seen_at < ? AND message_id != '${TRIGGER_START}'`).run(Date.now() - 7 * 86_400_000)
    return fresh
  }

  /** Whether a trigger has ever checked Gmail (its first check only records what's already there). */
  triggerStarted(triggerKey: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM trigger_seen WHERE trigger_key = ? AND message_id = ?').get(triggerKey, TRIGGER_START)
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
