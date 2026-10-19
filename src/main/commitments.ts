// Commitments: what the user said they'd do, and by when. An agent records them with a
// ```commitments block, Today lists them with Done / Missed buttons, and the agent that
// recorded them sees where each one stands at the top of every message. Keeping score
// in the app means the agent doesn't have to bring it up in every reply.
import { randomUUID } from 'node:crypto'
import type { Commitment, CommitmentStatus } from '@shared/types'

const DAY = 86_400_000
const STATUSES: CommitmentStatus[] = ['open', 'done', 'missed']
/** Closed commitments stay in the agent's view this long, so it can follow up on them. */
const SHOW_CLOSED_FOR = 14 * DAY
const MAX_SHOWN = 15

export const newCommitmentId = (): string => `c${randomUUID().replace(/-/g, '').slice(0, 8)}`

/** A real calendar date written as YYYY-MM-DD. */
export function isDate(v: unknown): v is string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false
  const [y, m, d] = v.split('-').map(Number)
  const t = new Date(y ?? 0, (m ?? 1) - 1, d ?? 1)
  return t.getFullYear() === y && t.getMonth() === (m ?? 0) - 1 && t.getDate() === d
}

/** Midnight at the start of a YYYY-MM-DD day, local time. */
export function dayStart(due: string): number {
  const [y, m, d] = due.split('-').map(Number)
  return new Date(y ?? 0, (m ?? 1) - 1, d ?? 1).getTime()
}

export interface ParsedCommitment {
  id?: string
  text?: string
  due?: string
  status?: CommitmentStatus
}

/** An entry from an agent's block, or null if it neither names a commitment nor describes a new one. */
export function parseCommitment(raw: Record<string, unknown>): ParsedCommitment | null {
  const out: ParsedCommitment = {}
  if (typeof raw['id'] === 'string' && /^c[0-9a-f]{8}$/.test(raw['id'].trim())) out.id = raw['id'].trim()
  const text = typeof raw['text'] === 'string' ? raw['text'].replace(/\s+/g, ' ').trim().slice(0, 200) : ''
  if (text) out.text = text
  if (isDate(raw['due'])) out.due = raw['due']
  if (STATUSES.includes(raw['status'] as CommitmentStatus)) out.status = raw['status'] as CommitmentStatus
  return out.id || out.text ? out : null
}

/** Same words, ignoring case, spacing and punctuation: how an update finds its commitment without an id. */
export const sameText = (a: string, b: string): boolean => {
  const norm = (s: string): string => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
  return norm(a) === norm(b)
}

/** An agent can't have more open commitments than this (keeps its per-message list short). */
export const MAX_OPEN = 30

/**
 * Works out what an agent's block changes: commitments to save, and a short line for each
 * change. Updates find their commitment by id, or by the same text among open ones; anything
 * else with a text and a due date is new.
 */
export function mergeCommitments(
  mine: Commitment[],
  items: Record<string, unknown>[],
  agentId: string,
  now: number
): { save: Commitment[]; changes: string[] } {
  const list = [...mine]
  const save: Commitment[] = []
  const changes: string[] = []
  for (const raw of items.slice(0, 20)) {
    const p = parseCommitment(raw)
    if (!p) continue
    const i = p.id ? list.findIndex((c) => c.id === p.id) : list.findIndex((c) => c.status === 'open' && !!p.text && sameText(c.text, p.text))
    const old = list[i]
    if (old) {
      const next: Commitment = { ...old, text: p.id && p.text ? p.text : old.text, due: p.due ?? old.due, status: p.status ?? old.status, updatedAt: now }
      if (next.text === old.text && next.due === old.due && next.status === old.status) continue
      list[i] = next
      save.push(next)
      changes.push(next.status !== old.status ? `${next.status === 'done' ? '✓' : next.status === 'missed' ? '✗' : '↺'} ${next.text}` : `${next.text} (now due ${next.due})`)
    } else if (!p.id && p.text && p.due && list.filter((c) => c.status === 'open').length < MAX_OPEN) {
      const c: Commitment = { id: newCommitmentId(), agentId, text: p.text, due: p.due, status: p.status ?? 'open', createdAt: now, updatedAt: now }
      list.push(c)
      save.push(c)
      changes.push(`+ ${c.text} (due ${c.due})`)
    }
  }
  return { save, changes }
}

/** When the free due-day nudge goes off: 9:00 on the day, if that's still ahead. */
export function nudgeAt(due: string, now: number): number | null {
  const at = dayStart(due) + 9 * 3_600_000
  return at > now ? at : null
}

/** Whole days past the due date (0 on the day itself or before). */
export function daysOverdue(due: string, now: number): number {
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  return Math.max(0, Math.round((today.getTime() - dayStart(due)) / DAY))
}

const shortDay = (ms: number): string => new Date(ms).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })

function state(c: Commitment, now: number): string {
  if (c.status === 'done') return `done (marked ${shortDay(c.updatedAt)})`
  if (c.status === 'missed') return 'missed'
  const late = daysOverdue(c.due, now)
  return late ? `OVERDUE by ${late} day${late > 1 ? 's' : ''}` : dayStart(c.due) <= now ? 'due today' : 'open'
}

/**
 * What the recording agent sees at the top of each message: its open commitments and the
 * ones closed in the last two weeks. Null when there's nothing, so most agents pay nothing.
 */
export function commitmentsBlock(list: Commitment[], now: number): string | null {
  const shown = list
    .filter((c) => c.status === 'open' || now - c.updatedAt < SHOW_CLOSED_FOR)
    .sort((a, b) => (a.status === 'open' ? 0 : 1) - (b.status === 'open' ? 0 : 1) || a.due.localeCompare(b.due))
    .slice(0, MAX_SHOWN)
  if (!shown.length) return null
  return `[Commitments you're tracking for the user. The user marks them on Today; update them with a commitments block when they tell you]\n${shown
    .map((c) => `- ${c.id} · ${c.text} · due ${shortDay(dayStart(c.due))} · ${state(c, now)}`)
    .join('\n')}`
}
