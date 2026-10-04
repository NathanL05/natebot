import { useState } from 'react'
import type { Reminder } from '@shared/types'
import { api } from '../lib/store'
import { dueTime } from '../lib/format'
import { ClockIcon, XIcon } from './icons'

const STATUS: Record<Reminder['status'], [string, string]> = {
  scheduled: ['Set', 'bg-accent/15 text-accent'],
  done: ['Done', 'bg-success/15 text-success'],
  cancelled: ['Cancelled', 'bg-elev-2 text-muted'],
  missed: ['Missed', 'bg-warn/15 text-warn']
}

/** A reminder an agent set. It's already scheduled; Cancel stops it. */
export function ReminderCard({ reminder }: { reminder: Reminder }) {
  const [busy, setBusy] = useState(false)
  const [label, cls] = STATUS[reminder.status]
  const off = reminder.status === 'cancelled' || reminder.status === 'missed'

  const cancel = async (): Promise<void> => {
    setBusy(true)
    try {
      await api.cancelReminder(reminder.id)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={`mt-2 flex w-full max-w-[480px] items-start gap-3 rounded-2xl border border-line bg-elev/60 px-4 py-2.5 ${off ? 'opacity-60' : ''}`}>
      <ClockIcon size={16} className="mt-0.5 shrink-0 text-accent" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-semibold">{dueTime(reminder.at)}</span>
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${cls}`}>{label}</span>
          {reminder.repeat && reminder.status === 'scheduled' && <span className="text-[11px] text-muted">repeats {reminder.repeat === 'weekdays' ? 'on weekdays' : reminder.repeat}</span>}
        </div>
        <div className="selectable mt-0.5 text-[13px] whitespace-pre-wrap">{reminder.text}</div>
        {reminder.kind === 'task' && <div className="mt-0.5 text-[11px] text-muted">The agent will work on this then (uses your Claude limit).</div>}
      </div>
      {reminder.status === 'scheduled' && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void cancel()}
          className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-[12px] text-muted transition hover:bg-hover hover:text-danger disabled:opacity-40"
        >
          <XIcon size={12} /> Cancel
        </button>
      )}
    </div>
  )
}
