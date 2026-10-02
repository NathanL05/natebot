import { useState } from 'react'
import type { Handoff } from '@shared/types'
import { api } from '../lib/store'
import { CheckIcon, SpinnerIcon, XIcon } from './icons'
import { Button } from './ui'

const STATUS: Record<Handoff['status'], [string, string]> = {
  pending: ['Needs your OK', 'bg-warn/15 text-warn'],
  sent: ['Handed off', 'bg-success/15 text-success'],
  dismissed: ['Dismissed', 'bg-elev-2 text-muted']
}

/** An agent's proposal to pass a task to another agent. Nothing is sent until you hand it off. */
export function HandoffCard({ messageId, handoff }: { messageId: string; handoff: Handoff }) {
  const [busy, setBusy] = useState(false)
  const pending = handoff.status === 'pending'
  const [label, cls] = STATUS[handoff.status]

  const resolve = async (decision: 'send' | 'dismiss'): Promise<void> => {
    setBusy(true)
    try {
      await api.resolveHandoff(messageId, handoff.id, decision)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className={`mt-2 w-full max-w-[480px] overflow-hidden rounded-2xl border bg-elev/60 ${pending ? 'border-warn/40' : 'border-line'} ${
        handoff.status === 'dismissed' ? 'opacity-60' : ''
      }`}
    >
      <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
        <span className="text-[11px] font-semibold tracking-wide text-muted uppercase">Hand off</span>
        <span className={`ml-auto rounded-full px-2 py-0.5 text-[11px] font-semibold ${cls}`}>{label}</span>
      </div>
      <div className="px-4 py-3">
        <div className="text-[14px] font-semibold">Pass this to {handoff.toName}</div>
        <div className="selectable mt-1.5 text-[13px] whitespace-pre-wrap">{handoff.task}</div>
        <div className="mt-1.5 text-[11px] text-muted">{handoff.toName} only sees this text, and uses its own tools and permissions.</div>
      </div>
      {pending && (
        <div className="flex gap-2 border-t border-line px-4 py-2.5">
          <Button variant="primary" disabled={busy} onClick={() => void resolve('send')}>
            {busy ? <SpinnerIcon size={13} /> : <CheckIcon size={13} />} Hand off
          </Button>
          <Button variant="ghost" className="ml-auto text-danger" disabled={busy} onClick={() => void resolve('dismiss')}>
            <XIcon size={13} /> Dismiss
          </Button>
        </div>
      )}
    </div>
  )
}
