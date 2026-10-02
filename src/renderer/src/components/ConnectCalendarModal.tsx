import { useEffect, useState } from 'react'
import type { GmailProgress, GmailStatus } from '@shared/types'
import { api, useStore } from '../lib/store'
import { SignInProgress } from './ConnectGmailModal'
import { SpinnerIcon, XIcon } from './icons'
import { Button, IconButton, Modal } from './ui'

const ENABLE_API = 'https://console.cloud.google.com/apis/library/calendar-json.googleapis.com'

const link = (url: string, text: string) => (
  <a
    href={url}
    className="text-accent"
    onClick={(e) => {
      e.preventDefault()
      void api.openExternal(url)
    }}
  >
    {text}
  </a>
)

/** Connects Google Calendar using Gmail's address and OAuth client, with its own sign-in. */
export function ConnectCalendarModal() {
  const close = (): void => useStore.getState().setCalendarOpen(false)
  const [status, setStatus] = useState<GmailStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<GmailProgress | null>(null)

  useEffect(() => {
    void api.calendarStatus().then(setStatus)
    return api.on('gmailProgress', setProgress)
  }, [])

  const connect = async (): Promise<void> => {
    setBusy(true)
    setProgress({ stage: 'starting', message: 'Starting…' })
    const res = await api.connectCalendar()
    if (!res.ok) setProgress({ stage: 'error', message: res.error ?? 'Something went wrong.' })
    setStatus(await api.calendarStatus())
    setBusy(false)
  }

  const done = progress?.stage === 'done'
  const gmailSetUp = !!status?.email && !!status.clientId && status.hasSecret

  return (
    <Modal onClose={busy ? () => undefined : close} width={520}>
      <div className="flex items-center border-b border-line px-5 py-3">
        <div className="flex-1 text-[15px] font-semibold">📅 Connect Google Calendar</div>
        <IconButton label="Close" onClick={close} disabled={busy}>
          <XIcon size={16} />
        </IconButton>
      </div>

      <div className="space-y-4 px-5 py-5 text-[13px] leading-relaxed">
        {status?.connected && !progress && (
          <div className="rounded-lg bg-success/10 px-3 py-2 text-success">✓ Calendar is connected. You can reconnect below if needed.</div>
        )}
        {status && !gmailSetUp && (
          <div className="rounded-lg bg-warn/10 px-3 py-2 text-warn">Connect Gmail first: Calendar uses the same Google address and OAuth client.</div>
        )}
        <p className="text-muted">
          Agents you give Calendar to can read your events and find free time{status?.email ? ` in ${status.email}` : ''}. Creating, changing, deleting or
          answering an event always needs your approval.
        </p>
        <p className="text-muted">
          One step first: in the Google Cloud project you made for Gmail, {link(ENABLE_API, 'enable the Google Calendar API')}. Then click Connect and approve
          Calendar access in the browser. It gets its own sign-in, so your Gmail connection isn't touched.
        </p>
        {progress && <SignInProgress progress={progress} />}
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">
        <Button variant="ghost" onClick={close} disabled={busy}>
          {done ? 'Close' : 'Cancel'}
        </Button>
        {!done && (
          <Button variant="primary" onClick={() => void connect()} disabled={busy || !gmailSetUp || !status?.uvInstalled}>
            {busy ? <SpinnerIcon size={13} /> : null} Connect
          </Button>
        )}
      </div>
    </Modal>
  )
}
