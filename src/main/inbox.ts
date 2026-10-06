// Today's Inbox: recent Gmail conversations read straight from the Gmail API with the
// Connect Gmail sign-in, so looking at your mail never runs Claude. Archive and Mark read
// are buttons the user clicks; agents still go through Approve for any change.
import type { Inbox, InboxMail } from '@shared/types'
import { GoogleToken } from './google-api'

const API = 'https://gmail.googleapis.com/gmail/v1/users/me'
/** The inbox minus the tabs nobody needs a summary of. */
export const INBOX_QUERY = 'in:inbox -category:promotions -category:social newer_than:3d'
const MAX_MAILS = 25
const CACHE_MS = 2 * 60_000
/** Gmail refuses (429) too many requests at once from one user. */
const PARALLEL = 4

interface GmailMessage {
  id: string
  threadId: string
  snippet?: string
  internalDate?: string
  labelIds?: string[]
  payload?: { headers?: { name: string; value: string }[] }
}

/** `"Ann Lee" <ann@x.com>` → name and address. */
export function parseFrom(header: string): { name: string; address: string } {
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(header)
  if (m) return { name: m[1]?.trim() || (m[2] ?? '').trim(), address: (m[2] ?? '').trim() }
  return { name: header.trim(), address: header.trim() }
}

/** Gmail snippets come HTML-escaped. */
function unescape(text: string): string {
  return text
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

/** Gmail messages → one row per conversation (its latest message), newest first. */
export function toMails(messages: GmailMessage[]): InboxMail[] {
  const byThread = new Map<string, InboxMail>()
  for (const m of messages) {
    const header = (name: string): string => m.payload?.headers?.find((h) => h.name.toLowerCase() === name)?.value ?? ''
    const from = parseFrom(header('from'))
    const mail: InboxMail = {
      id: m.id,
      threadId: m.threadId,
      from: from.name,
      fromAddress: from.address,
      subject: header('subject').trim() || '(no subject)',
      snippet: unescape(m.snippet ?? '').trim(),
      at: Number(m.internalDate) || 0,
      unread: m.labelIds?.includes('UNREAD') ?? false
    }
    const seen = byThread.get(m.threadId)
    if (!seen) byThread.set(m.threadId, mail)
    else if (mail.at > seen.at) byThread.set(m.threadId, { ...mail, unread: mail.unread || seen.unread })
    else if (mail.unread) seen.unread = true
  }
  return [...byThread.values()].sort((a, b) => b.at - a.at)
}

/** Maps with at most `limit` calls in flight, keeping the order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i] as T)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

export class InboxReader {
  private google: GoogleToken
  private cache: { at: number; inbox: Inbox } | null = null

  constructor(
    private tokenPath: () => string | null,
    private address: () => string | null,
    onExpired: (path: string) => void = () => undefined
  ) {
    this.google = new GoogleToken(tokenPath, onExpired)
  }

  connected(): boolean {
    return this.google.available()
  }

  async list(refresh = false): Promise<Inbox> {
    const email = this.address()
    if (!this.google.available()) return { connected: false, email, mails: [], error: null }
    if (!refresh && this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache.inbox
    let inbox: Inbox
    try {
      const q = encodeURIComponent(INBOX_QUERY)
      const list = await this.google.fetchJson<{ messages?: { id: string }[] }>(`${API}/messages?q=${q}&maxResults=${MAX_MAILS}`)
      const messages = await mapLimit(list.messages ?? [], PARALLEL, (m) =>
        this.google.fetchJson<GmailMessage>(`${API}/messages/${encodeURIComponent(m.id)}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`)
      )
      inbox = { connected: true, email, mails: toMails(messages), error: null }
    } catch (e) {
      // A dead sign-in has been set aside by now: show Gmail as disconnected.
      if (!this.google.available()) return { connected: false, email, mails: [], error: null }
      return { connected: true, email, mails: this.cache?.inbox.mails ?? [], error: `Gmail could not be read (${(e as Error).message})` }
    }
    this.cache = { at: Date.now(), inbox }
    return inbox
  }

  /** Archive (out of the inbox) or mark read a whole conversation. */
  async modify(threadId: string, change: 'archive' | 'read'): Promise<void> {
    const label = change === 'archive' ? 'INBOX' : 'UNREAD'
    await this.google.postJson(`${API}/threads/${encodeURIComponent(threadId)}/modify`, { removeLabelIds: [label] })
    if (this.cache) {
      const mails = this.cache.inbox.mails
      this.cache.inbox = {
        ...this.cache.inbox,
        mails: change === 'archive' ? mails.filter((m) => m.threadId !== threadId) : mails.map((m) => (m.threadId === threadId ? { ...m, unread: false } : m))
      }
    }
  }
}

