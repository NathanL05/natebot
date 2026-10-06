import { useEffect, useState } from 'react'
import type { GmailProgress, GmailStatus } from '@shared/types'
import { api, useStore } from '../lib/store'
import { SignInProgress } from './ConnectGmailModal'
import { SpinnerIcon, XIcon } from './icons'
import { Button, IconButton, Modal } from './ui'

export type ExtraGoogle = 'gcal' | 'gtasks' | 'gdrive'

const COPY: Record<ExtraGoogle, { title: string; short: string; api: string; apiName: string; what: string }> = {
  gcal: {
    title: '📅 Connect Google Calendar',
    short: 'Calendar',
    api: 'https://console.cloud.google.com/apis/library/calendar-json.googleapis.com',
    apiName: 'the Google Calendar API',
    what: 'read your events and find free time. Creating, changing, deleting or answering an event always needs your approval.'
  },
  gtasks: {
    title: '✅ Connect Google Tasks',
    short: 'Tasks',
    api: 'https://console.cloud.google.com/apis/library/tasks.googleapis.com',
    apiName: 'the Google Tasks API',
    what: 'read your task lists (they sync to Google Calendar and the Tasks app on your phone). Adding, completing or deleting a task needs your approval.'
  },
  gdrive: {
    title: '📁 Connect Google Drive',
    short: 'Drive',
    api: 'https://console.cloud.google.com/apis/library/drive.googleapis.com',
    apiName: 'the Google Drive API and the Google Docs API',
    what: 'search and read your Drive files and Docs (lecture notes, CVs, cover letters). Creating or editing files needs your approval.'
  }
}

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

/** Connects Calendar, Tasks or Drive using Gmail's address and OAuth client, each with its own sign-in. */
export function ConnectGoogleModal({ server }: { server: ExtraGoogle }) {
  const copy = COPY[server]
  const close = (): void => useStore.getState().setGoogleOpen(null)
  const [status, setStatus] = useState<GmailStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<GmailProgress | null>(null)

  useEffect(() => {
    void api.googleStatus(server).then(setStatus)
    return api.on('gmailProgress', setProgress)
  }, [server])

  const connect = async (): Promise<void> => {
    setBusy(true)
    setProgress({ stage: 'starting', message: 'Starting…' })
    const res = await api.connectGoogle(server)
    if (!res.ok) setProgress({ stage: 'error', message: res.error ?? 'Something went wrong.' })
    setStatus(await api.googleStatus(server))
    setBusy(false)
  }

  const done = progress?.stage === 'done'
  const gmailSetUp = !!status?.email && !!status.clientId && status.hasSecret

  return (
    <Modal onClose={busy ? () => undefined : close} width={520}>
      <div className="flex items-center border-b border-line px-5 py-3">
        <div className="flex-1 text-[15px] font-semibold">{copy.title}</div>
        <IconButton label="Close" onClick={close} disabled={busy}>
          <XIcon size={16} />
        </IconButton>
      </div>

      <div className="space-y-4 px-5 py-5 text-[13px] leading-relaxed">
        {status?.expired && !progress && (
          <div className="rounded-lg bg-warn/10 px-3 py-2 text-warn">
            {copy.short}'s sign-in expired. Click Connect to sign in again (publishing your Google app stops the weekly expiry).
          </div>
        )}
        {status?.connected && !progress && (
          <div className="rounded-lg bg-success/10 px-3 py-2 text-success">✓ {copy.short} is connected. You can reconnect below if needed.</div>
        )}
        {status && !gmailSetUp && (
          <div className="rounded-lg bg-warn/10 px-3 py-2 text-warn">Connect Gmail first: {copy.short} uses the same Google address and OAuth client.</div>
        )}
        <p className="text-muted">
          Agents you give {copy.short} to can {copy.what}
        </p>
        <p className="text-muted">
          One step first: in the Google Cloud project you made for Gmail, {link(copy.api, `enable ${copy.apiName}`)}. Then click Connect and approve
          access in the browser. It gets its own sign-in, so your Gmail connection isn't touched.
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
