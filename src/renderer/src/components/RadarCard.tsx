// Today's job radar: roles at the companies you care about, found in job-alert email by
// NateBot itself (no Claude run). Open the job, add it to the tracker, or hide it.
import { useEffect, useState } from 'react'
import { gmailLink, type JobRadar, type RadarHit } from '@shared/types'
import { api, useStore } from '../lib/store'
import { listTime } from '../lib/format'
import { BriefcaseIcon, ChevronIcon, ExternalIcon, XIcon } from './icons'
import { IconButton } from './ui'

export function RadarCard() {
  const on = useStore((s) => !!s.settings?.jobRadar)
  // Agents change after the radar finds something or a find is tracked or hidden.
  const agents = useStore((s) => s.agents)
  const [radar, setRadar] = useState<JobRadar | null>(null)
  const [showSeen, setShowSeen] = useState(false)
  const [checking, setChecking] = useState(false)

  useEffect(() => void api.jobRadar().then(setRadar), [agents, on])

  if (!radar || (!radar.active && radar.hits.length === 0)) return null

  const refresh = async (): Promise<void> => {
    setChecking(true)
    try {
      setRadar(await api.jobRadar(true))
    } finally {
      setChecking(false)
    }
  }

  const act = async (hit: RadarHit, action: 'track' | 'dismiss' | 'restore'): Promise<void> => {
    await api.radarAction(hit.id, action)
    setRadar(await api.jobRadar())
  }

  const fresh = radar.hits.filter((h) => h.status === 'new')
  const seen = radar.hits.filter((h) => h.status !== 'new')

  const row = (h: RadarHit) => (
    <div key={h.id} className={`group flex items-center gap-3 px-4 py-2.5 ${h.status === 'new' ? '' : 'opacity-60'}`}>
      <button
        type="button"
        title={h.link ? 'Open the job' : 'Open the email in Gmail'}
        onClick={() => void api.openExternal(h.link ?? gmailLink(radar.email, h.threadId))}
        className="min-w-0 flex-1 text-left"
      >
        <div className="flex items-baseline gap-2">
          <span className="truncate text-[13px] font-semibold">{h.company}</span>
          {h.status === 'tracked' && <span className="shrink-0 text-[11px] text-success">In tracker</span>}
          <span className="ml-auto shrink-0 text-[11px] text-muted">{listTime(h.receivedAt)}</span>
        </div>
        <div className="truncate text-[12px]">
          {h.title}
          {h.location && <span className="text-muted"> · {h.location}</span>}
          <span className="text-muted"> · via {h.from}</span>
        </div>
      </button>
      <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        <IconButton className="h-7 w-7" label={h.link ? 'Open the job' : 'Open in Gmail'} onClick={() => void api.openExternal(h.link ?? gmailLink(radar.email, h.threadId))}>
          <ExternalIcon size={14} />
        </IconButton>
        {h.status === 'new' && (
          <>
            <IconButton className="h-7 w-7" label="Add to job tracker" onClick={() => void act(h, 'track')}>
              <BriefcaseIcon size={14} />
            </IconButton>
            <IconButton className="h-7 w-7" label="Hide" onClick={() => void act(h, 'dismiss')}>
              <XIcon size={14} />
            </IconButton>
          </>
        )}
        {h.status === 'dismissed' && (
          <button type="button" onClick={() => void act(h, 'restore')} className="rounded-md px-1.5 py-1 text-[12px] text-muted hover:bg-hover hover:text-fg">
            Restore
          </button>
        )}
      </div>
    </div>
  )

  return (
    <section className="mb-8">
      <div className="mb-2 flex items-center gap-3">
        <h2 className="text-[14px] font-semibold">Job radar</h2>
        <span className="text-[12px] text-muted">{fresh.length ? `${fresh.length} new at your companies` : 'your companies · last 2 weeks'}</span>
        {radar.active && (
          <button type="button" disabled={checking} onClick={() => void refresh()} className="ml-auto text-[12px] text-muted hover:text-fg disabled:opacity-40">
            {checking ? 'Checking…' : 'Check now'}
          </button>
        )}
      </div>
      <div className="divide-y divide-line overflow-hidden rounded-2xl bg-elev/60">
        {fresh.map(row)}
        {fresh.length === 0 && (
          <div className="px-4 py-4 text-center text-[13px] text-muted">
            No new roles at your companies in your job alerts.{' '}
            <button type="button" className="text-accent" onClick={() => useStore.getState().setView('settings')}>
              Companies…
            </button>
          </div>
        )}
        {seen.length > 0 && (
          <button type="button" onClick={() => setShowSeen(!showSeen)} className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-[12px] text-muted hover:text-fg">
            <ChevronIcon size={12} className={`shrink-0 transition-transform ${showSeen ? 'rotate-90' : ''}`} />
            {seen.length} tracked or hidden
          </button>
        )}
        {showSeen && seen.map(row)}
        {radar.error && <div className="px-4 py-2 text-[12px] text-warn">Couldn't check Gmail: {radar.error}</div>}
      </div>
    </section>
  )
}
