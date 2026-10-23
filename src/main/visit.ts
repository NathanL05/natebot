// "Since you were last here": what arrived while you were away, at the top of Today. Built
// from what NateBot already stores, so it never runs Claude. You're "away" once the window
// has been in the background for an hour, or while NateBot was closed.
import type { ChatMessage, VisitSummary } from '@shared/types'

export const AWAY_MS = 3_600_000
const MAX_CHATS = 8
const MAX_TEXT = 160

export interface Visit {
  /** When you were last here. */
  from: number
  /** When you came back; null until the window is first looked at. */
  to: number | null
  /** When NateBot was quit and started again, if it was closed in between. */
  closed: { at: number; until: number } | null
}

/**
 * The visit NateBot starts with. lastSeen is when the window last lost focus, closedAt when
 * NateBot was last quit (crashes leave none), and fallback when you last wrote anything,
 * for the first launch that has no lastSeen yet.
 */
export function startupVisit(lastSeen: number | null, closedAt: number | null, fallback: number | null, now: number): Visit | null {
  const from = lastSeen ?? fallback
  if (from === null || now - from < AWAY_MS) return null
  // Closed after you last looked: the quit is the last thing that happened before this start.
  const closed = closedAt !== null && closedAt >= from && closedAt <= now ? { at: closedAt, until: now } : null
  return { from, to: null, closed }
}

/** The window came back. Returns the visit to show now, or null to keep the current one. */
export function returnVisit(current: Visit | null, lastSeen: number | null, now: number): Visit | null {
  // The first look since NateBot started (it may have started hidden, at login).
  if (current && current.to === null) return { ...current, to: now }
  if (lastSeen === null || now - lastSeen < AWAY_MS) return null
  return { from: lastSeen, to: now, closed: null }
}

/** Markdown and whitespace out, cut short, for a one-line preview. */
export function previewText(text: string): string {
  const plain = text
    .replace(/```[\s\S]*?(```|$)/g, ' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, '')
    .replace(/[*_`#>|]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return plain.length > MAX_TEXT ? `${plain.slice(0, MAX_TEXT - 1).trimEnd()}…` : plain
}

export function summarizeVisit(
  visit: Visit,
  messages: ChatMessage[],
  counts: { approvals: number; radar: number; due: number }
): VisitSummary {
  // Newest first, so the first message seen for a chat is its latest.
  const byChat = new Map<string, VisitSummary['chats'][number] & { fromAgent: boolean }>()
  for (const m of [...messages].sort((a, b) => b.createdAt - a.createdAt)) {
    if (m.streaming || !m.text.trim()) continue
    const chat = byChat.get(m.agentId)
    const entry = { messageId: m.id, text: previewText(m.text), at: m.createdAt, fromAgent: m.role === 'agent' }
    if (!chat) byChat.set(m.agentId, { chatId: m.agentId, count: 1, ...entry })
    else {
      chat.count++
      // Show what an agent said over a NateBot line ("Routine ran at 7:30 PM") when there's both.
      if (!chat.fromAgent && entry.fromAgent) Object.assign(chat, entry, { at: chat.at })
    }
  }
  const chats = [...byChat.values()].slice(0, MAX_CHATS).map(({ fromAgent: _, ...c }) => c)
  return {
    since: visit.from,
    closedAt: visit.closed?.at ?? null,
    startedAt: visit.closed?.until ?? null,
    chats,
    ...counts
  }
}
