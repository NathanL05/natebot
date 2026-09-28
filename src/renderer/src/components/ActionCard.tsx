import { useState } from 'react'
import type { ProposedAction } from '@shared/types'
import { api } from '../lib/store'
import { CheckIcon, PencilIcon, SpinnerIcon, XIcon } from './icons'
import { Button, inputClass } from './ui'

const toText = (v: unknown): string => (typeof v === 'string' ? v : JSON.stringify(v, null, 2))
const titleCase = (s: string): string => s.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

function StatusBadge({ action }: { action: ProposedAction }) {
  const styles: Record<ProposedAction['status'], [string, string]> = {
    pending: ['Needs approval', 'bg-warn/15 text-warn'],
    executing: ['Working…', 'bg-accent/15 text-accent'],
    done: ['Done', 'bg-success/15 text-success'],
    failed: ['Failed', 'bg-danger/15 text-danger'],
    rejected: ['Rejected', 'bg-elev-2 text-muted']
  }
  const [text, cls] = styles[action.status]
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${cls}`}>{text}</span>
}

/** A proposed irreversible action (send, delete, post…) awaiting approval. */
export function ActionCard({ messageId, action }: { messageId: string; action: ProposedAction }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  const entries = Object.entries(action.details)
  const pending = action.status === 'pending'

  const startEdit = (): void => {
    setDraft(Object.fromEntries(entries.map(([k, v]) => [k, toText(v)])))
    setEditing(true)
  }

  const edited = (): Record<string, unknown> =>
    Object.fromEntries(
      entries.map(([k, original]) => {
        const text = draft[k] ?? toText(original)
        if (typeof original === 'string') return [k, text]
        try {
          return [k, JSON.parse(text)]
        } catch {
          return [k, text]
        }
      })
    )

  const resolve = async (decision: 'approve' | 'reject'): Promise<void> => {
    setBusy(true)
    try {
      await api.resolveAction(messageId, action.id, decision, decision === 'approve' && editing ? edited() : undefined)
      setEditing(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className={`mt-2 w-full max-w-[480px] overflow-hidden rounded-2xl border bg-elev/60 ${
        pending ? 'border-warn/40' : 'border-line'
      } ${action.status === 'rejected' ? 'opacity-60' : ''}`}
    >
      <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
        <span className="text-[11px] font-semibold tracking-wide text-muted uppercase">{titleCase(action.type)}</span>
        <span className="ml-auto">
          <StatusBadge action={action} />
        </span>
      </div>

      <div className="px-4 py-3">
        <div className="text-[14px] font-semibold">{action.summary}</div>
        <dl className="mt-2 space-y-2">
          {entries.map(([k, v]) => {
            const text = toText(v)
            const multiline = text.includes('\n') || text.length > 80
            return (
              <div key={k}>
                <dt className="text-[11px] font-medium tracking-wide text-muted uppercase">{titleCase(k)}</dt>
                <dd className="mt-0.5">
                  {editing ? (
                    multiline ? (
                      <textarea
                        className={`${inputClass} min-h-[110px] resize-y text-[13px]`}
                        value={draft[k] ?? ''}
                        onChange={(e) => setDraft({ ...draft, [k]: e.target.value })}
                      />
                    ) : (
                      <input
                        className={`${inputClass} text-[13px]`}
                        value={draft[k] ?? ''}
                        onChange={(e) => setDraft({ ...draft, [k]: e.target.value })}
                      />
                    )
                  ) : (
                    <div className="selectable text-[13px] whitespace-pre-wrap">{text}</div>
                  )}
                </dd>
              </div>
            )
          })}
        </dl>
        {action.result && (
          <div className={`mt-3 text-[12px] ${action.status === 'failed' ? 'text-danger' : 'text-success'}`}>{action.result}</div>
        )}
      </div>

      {pending && (
        <div className="flex gap-2 border-t border-line px-4 py-2.5">
          <Button variant="primary" disabled={busy} onClick={() => void resolve('approve')}>
            {busy ? <SpinnerIcon size={13} /> : <CheckIcon size={13} />}
            {editing ? 'Approve edited' : 'Approve'}
          </Button>
          {editing ? (
            <Button variant="ghost" disabled={busy} onClick={() => setEditing(false)}>
              Cancel edit
            </Button>
          ) : (
            <Button disabled={busy} onClick={startEdit}>
              <PencilIcon size={13} /> Edit
            </Button>
          )}
          <Button variant="ghost" className="ml-auto text-danger" disabled={busy} onClick={() => void resolve('reject')}>
            <XIcon size={13} /> Reject
          </Button>
        </div>
      )}
      {action.status === 'executing' && (
        <div className="flex items-center gap-2 border-t border-line px-4 py-2.5 text-[12px] text-muted">
          <SpinnerIcon size={12} /> Running just this one action…
        </div>
      )}
    </div>
  )
}
