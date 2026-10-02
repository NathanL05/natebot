import { useEffect, useState } from 'react'
import type { GmailProgress, GmailStatus } from '@shared/types'
import { api, useStore } from '../lib/store'
import { CheckIcon, SpinnerIcon, XIcon } from './icons'
import { Button, Field, IconButton, inputClass, Modal } from './ui'

const GUIDE = 'https://github.com/NathanL05/natebot#connecting-gmail'

export function ConnectGmailModal() {
  const close = (): void => useStore.getState().setGmailOpen(false)
  const [status, setStatus] = useState<GmailStatus | null>(null)
  const [email, setEmail] = useState('')
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<GmailProgress | null>(null)

  useEffect(() => {
    void api.gmailStatus().then((s) => {
      setStatus(s)
      if (s.email) setEmail(s.email)
      if (s.clientId) setClientId(s.clientId)
    })
    return api.on('gmailProgress', setProgress)
  }, [])

  const connect = async (): Promise<void> => {
    setBusy(true)
    setProgress({ stage: 'starting', message: 'Starting…' })
    const res = await api.connectGmail(email, clientId, clientSecret)
    if (!res.ok) setProgress({ stage: 'error', message: res.error ?? 'Something went wrong.' })
    setStatus(await api.gmailStatus())
    setBusy(false)
  }

  const done = progress?.stage === 'done'

  return (
    <Modal onClose={busy ? () => undefined : close} width={560}>
      <div className="flex items-center border-b border-line px-5 py-3">
        <div className="flex-1 text-[15px] font-semibold">📧 Connect Gmail</div>
        <IconButton label="Close" onClick={close} disabled={busy}>
          <XIcon size={16} />
        </IconButton>
      </div>

      <div className="space-y-4 overflow-y-auto px-5 py-5 text-[13px]">
        {status?.connected && !progress && (
          <div className="rounded-lg bg-success/10 px-3 py-2 text-success">
            ✓ Gmail is connected{status.email ? ` as ${status.email}` : ''}. You can reconnect below if needed.
          </div>
        )}
        {status && !status.uvInstalled && (
          <div className="rounded-lg bg-warn/10 px-3 py-2 text-warn">
            First install <strong>uv</strong> (it runs the Gmail connector). In Terminal:{' '}
            <code className="selectable font-mono">brew install uv</code>
          </div>
        )}

        <p className="leading-relaxed text-muted">
          NateBot uses the open-source <em>Google Workspace MCP</em> connector on your Mac. You need a free Google Cloud
          OAuth client (about 5 minutes, one time).{' '}
          <a
            href={GUIDE}
            className="text-accent"
            onClick={(e) => {
              e.preventDefault()
              void api.openExternal(GUIDE)
            }}
          >
            Step-by-step guide
          </a>
          . Agents can read, search and draft; sending always needs your approval.
        </p>

        <Field label="Your Gmail address">
          <input className={inputClass} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@gmail.com" disabled={busy} />
        </Field>
        <Field label="OAuth client ID">
          <input
            className={`${inputClass} font-mono text-[12px]`}
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            placeholder="1234-abc.apps.googleusercontent.com"
            disabled={busy}
          />
        </Field>
        <Field label="OAuth client secret" hint="Stored only in ~/NateBot/mcp.json on this Mac (owner-only file).">
          <input
            className={`${inputClass} font-mono text-[12px]`}
            type="password"
            value={clientSecret}
            onChange={(e) => setClientSecret(e.target.value)}
            placeholder={status?.hasSecret && status.clientId === clientId.trim() ? 'Saved (leave empty to reuse)' : 'GOCSPX-…'}
            disabled={busy}
          />
        </Field>

        {progress && <SignInProgress progress={progress} />}
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">
        <Button variant="ghost" onClick={close} disabled={busy}>
          {done ? 'Close' : 'Cancel'}
        </Button>
        {!done && (
          <Button variant="primary" onClick={() => void connect()} disabled={busy || !email || !clientId || (!clientSecret && !(status?.hasSecret && status.clientId === clientId.trim()))}>
            {busy ? <SpinnerIcon size={13} /> : null} Connect
          </Button>
        )}
      </div>
    </Modal>
  )
}

/** The live status of a Google sign-in (shared with Connect Calendar). */
export function SignInProgress({ progress }: { progress: GmailProgress }) {
  const done = progress.stage === 'done'
  return (
    <div
      className={`flex items-start gap-2 rounded-lg px-3 py-2.5 ${
        progress.stage === 'error' ? 'bg-danger/10 text-danger' : done ? 'bg-success/10 text-success' : 'bg-elev'
      }`}
    >
      {progress.stage === 'error' ? (
        <XIcon size={14} className="mt-0.5 shrink-0" />
      ) : done ? (
        <CheckIcon size={14} className="mt-0.5 shrink-0" />
      ) : (
        <SpinnerIcon size={14} className="mt-0.5 shrink-0" />
      )}
      <div className="selectable min-w-0">
        <div>{progress.message}</div>
        {progress.stage === 'signin' && progress.url && (
          <button type="button" className="mt-1 text-accent" onClick={() => void api.openExternal(progress.url as string)}>
            Didn't see a browser window? Open the Google sign-in page
          </button>
        )}
      </div>
    </div>
  )
}
