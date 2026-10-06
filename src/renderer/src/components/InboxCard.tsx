// Today's Inbox: recent Gmail conversations read directly (no Claude run), with
// Open in Gmail, Mark read and Archive, and a way to ask the email agent about one.
import { useEffect, useState, type ReactNode } from 'react'
import { gmailLink, type Inbox, type InboxMail } from '@shared/types'
import { api, useStore } from '../lib/store'
import { drafts } from '../lib/drafts'
import { listTime } from '../lib/format'
import { ArchiveIcon, MailOpenIcon, ReplyIcon } from './icons'

const SHOWN = 8

export function InboxCard() {
  const [inbox, setInbox] = useState<Inbox | null>(null)
  const [all, setAll] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // The agent to ask about an email: one with Gmail, preferring a chat agent over the brief or job hunter.
  const helper = useStore((s) => {
    const withGmail = s.agents.filter((a) => a.mcp_servers.includes('gmail'))
    return withGmail.find((a) => a.id !== 'morning-brief' && a.id !== 'job-hunter') ?? withGmail[0] ?? null
  })

  useEffect(() => void api.inbox().then(setInbox), [])

  if (!inbox) return null
  if (!inbox.connected) {
    return (
      <section className="mb-8">
        <h2 className="mb-2 text-[14px] font-semibold">Inbox</h2>
        <div className="text-[12px] text-muted">
          Connect Gmail in{' '}
          <button type="button" className="text-accent" onClick={() => useStore.getState().setView('settings')}>
            Settings → Connected tools
          </button>{' '}
          to see your recent email here. Reading it uses no Claude usage.
        </div>
      </section>
    )
  }

  const refresh = (): void => {
    setError(null)
    void api.inbox(true).then(setInbox)
  }

  const change = async (mail: InboxMail, what: 'archive' | 'read'): Promise<void> => {
    setBusy(mail.threadId)
    setError(null)
    const res = await api.inboxAction(mail.threadId, what)
    setBusy(null)
    if (!res.ok) return setError(res.error ?? 'Gmail did not accept that.')
    setInbox((cur) =>
      cur && {
        ...cur,
        mails: what === 'archive' ? cur.mails.filter((m) => m.threadId !== mail.threadId) : cur.mails.map((m) => (m.threadId === mail.threadId ? { ...m, unread: false } : m))
      }
    )
  }

  const ask = (mail: InboxMail): void => {
    if (!helper) return
    drafts.set(helper.id, `About the email from ${mail.from} ("${mail.subject}", Gmail message id ${mail.id}): `)
    useStore.getState().select(helper.id)
  }

  const unread = inbox.mails.filter((m) => m.unread).length
  const shown = all ? inbox.mails : inbox.mails.slice(0, SHOWN)
  return (
    <section className="mb-8">
      <div className="mb-2 flex items-center gap-3">
        <h2 className="text-[14px] font-semibold">Inbox</h2>
        <span className="text-[12px] text-muted">{unread ? `${unread} unread · last 3 days` : 'last 3 days'}</span>
        <button type="button" onClick={refresh} className="ml-auto text-[12px] text-muted hover:text-fg">
          Refresh
        </button>
      </div>
      <div className="divide-y divide-line overflow-hidden rounded-2xl bg-elev/60">
        {shown.map((m) => (
          <div key={m.threadId} className={`group flex items-center gap-3 px-4 py-2.5 ${busy === m.threadId ? 'opacity-50' : ''}`}>
            <span className={`h-2 w-2 shrink-0 rounded-full ${m.unread ? 'bg-accent' : ''}`} />
            <button
              type="button"
              title="Open in Gmail"
              onClick={() => void api.openExternal(gmailLink(inbox.email, m.threadId))}
              className="min-w-0 flex-1 text-left"
            >
              <div className="flex items-baseline gap-2">
                <span className={`truncate text-[13px] ${m.unread ? 'font-semibold' : ''}`}>{m.from}</span>
                <span className="ml-auto shrink-0 text-[11px] text-muted">{listTime(m.at)}</span>
              </div>
              <div className="truncate text-[12px]">
                <span className={m.unread ? 'font-medium' : ''}>{m.subject}</span>
                {m.snippet && <span className="text-muted"> · {m.snippet}</span>}
              </div>
            </button>
            <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
              {helper && (
                <IconButton label={`Ask ${helper.name}`} onClick={() => ask(m)}>
                  <ReplyIcon size={14} />
                </IconButton>
              )}
              {m.unread && (
                <IconButton label="Mark read" disabled={busy !== null} onClick={() => void change(m, 'read')}>
                  <MailOpenIcon size={14} />
                </IconButton>
              )}
              <IconButton label="Archive" disabled={busy !== null} onClick={() => void change(m, 'archive')}>
                <ArchiveIcon size={14} />
              </IconButton>
            </div>
          </div>
        ))}
        {inbox.mails.length === 0 && !inbox.error && <div className="px-4 py-4 text-center text-[13px] text-muted">Nothing new in the last 3 days.</div>}
        {inbox.mails.length > SHOWN && (
          <button type="button" onClick={() => setAll(!all)} className="w-full px-4 py-2 text-center text-[12px] text-muted hover:text-fg">
            {all ? 'Show fewer' : `Show all ${inbox.mails.length}`}
          </button>
        )}
        {(error ?? inbox.error) && <div className="px-4 py-2 text-[12px] text-warn">{error ?? inbox.error}</div>}
      </div>
    </section>
  )
}

function IconButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="rounded-md p-1.5 text-muted hover:bg-hover hover:text-fg disabled:opacity-40"
    >
      {children}
    </button>
  )
}
