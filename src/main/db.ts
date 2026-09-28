// Chat history, per-agent state and run logs in SQLite (~/NateBot/data.db).
// Uses Node's built-in node:sqlite, so there is no native module to rebuild.
import { DatabaseSync } from 'node:sqlite'
import type { ChatMessage, MessageRole } from '@shared/types'

interface MessageRow {
  id: string
  agent_id: string
  role: string
  text: string
  created_at: number
  data: string | null
}

export interface RunRecord {
  id: string
  agentId: string
  source: 'chat' | 'routine' | 'action'
  startedAt: number
  endedAt: number | null
  ok: boolean | null
  summary: string | null
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
    `)
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

  // ---- runs ----

  startRun(id: string, agentId: string, source: RunRecord['source']): void {
    this.db.prepare('INSERT INTO runs (id, agent_id, source, started_at) VALUES (?, ?, ?, ?)').run(id, agentId, source, Date.now())
  }

  finishRun(id: string, ok: boolean, summary: string): void {
    this.db.prepare('UPDATE runs SET ended_at = ?, ok = ?, summary = ? WHERE id = ?').run(Date.now(), ok ? 1 : 0, summary.slice(0, 300), id)
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

  deleteAgent(agentId: string): void {
    this.db.prepare('DELETE FROM messages WHERE agent_id = ?').run(agentId)
    this.db.prepare('DELETE FROM agent_state WHERE agent_id = ?').run(agentId)
    this.db.prepare('DELETE FROM runs WHERE agent_id = ?').run(agentId)
  }
}
