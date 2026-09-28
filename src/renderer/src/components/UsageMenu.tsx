import { useEffect, useRef, useState } from 'react'
import type { UsageWindow } from '@shared/types'
import { api, useStore } from '../lib/store'
import { ago, countdown, LEVEL_COLOR, pct, resetTime, usageLevel, type UsageLevel } from '../lib/usage'
import { RefreshIcon } from './icons'

/** Re-render every 30 s so countdowns stay current. */
function useNow(): number {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])
  return now
}

const NONE: UsageWindow = { utilization: null, resetsAt: null }

// Ring colours while usage is comfortable; amber/red take over as it fills.
const SESSION_HUE = 'var(--accent)'
const WEEK_HUE = '#A06CFF'
const ringColor = (level: UsageLevel, hue: string): string => (level === 'warn' || level === 'high' ? LEVEL_COLOR[level] : hue)

function Arc({ r, value, color, center }: { r: number; value: number | null; color: string; center: number }) {
  const c = 2 * Math.PI * r
  const filled = value === null ? 0 : Math.min(1, Math.max(0, value))
  return (
    <>
      <circle cx={center} cy={center} r={r} fill="none" stroke="var(--elev-2)" strokeWidth="3" />
      {filled > 0 && (
        <circle
          cx={center}
          cy={center}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={`${Math.max(filled * c, 0.01)} ${c}`}
          style={{ transition: 'stroke-dasharray 0.4s ease, stroke 0.4s ease' }}
        />
      )}
    </>
  )
}

/** Activity-style rings: outer = 5-hour session, inner = week. */
function Rings({ session, week, sessionColor, weekColor }: { session: number | null; week: number | null; sessionColor: string; weekColor: string }) {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" className="shrink-0 -rotate-90" aria-hidden="true">
      <Arc center={11} r={9.5} value={session} color={sessionColor} />
      <Arc center={11} r={5} value={week} color={weekColor} />
    </svg>
  )
}

function WindowRow({ title, hue, window: w, limited, now }: { title: string; hue: string; window: UsageWindow; limited: boolean; now: number }) {
  const level = usageLevel(w, limited)
  const color = ringColor(level, hue)
  const value = limited ? 1 : (w.utilization ?? 0)
  const left = countdown(w.resetsAt, now)
  return (
    <div>
      <div className="flex items-baseline gap-2">
        <span className="h-2 w-2 shrink-0 translate-y-[-1px] rounded-full" style={{ background: color }} />
        <span className="text-[12.5px] font-medium">{title}</span>
        <span className="ml-auto text-[15px] font-semibold tabular-nums" style={{ color: level === 'warn' || level === 'high' ? color : undefined }}>
          {limited ? '100%' : pct(w.utilization)}
        </span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-elev-2">
        <div className="h-full rounded-full transition-all" style={{ width: `${Math.round(value * 100)}%`, background: color }} />
      </div>
      <div className={`mt-1 text-[11.5px] tabular-nums ${limited ? 'text-danger' : 'text-muted'}`}>
        {limited
          ? `Limit reached · resets ${w.resetsAt ? `${resetTime(w.resetsAt)} (in ${left})` : 'soon'}`
          : w.resetsAt
            ? `Resets ${resetTime(w.resetsAt)} · in ${left}`
            : w.utilization === null
              ? 'Checking…'
              : 'Window starts with your next message'}
      </div>
    </div>
  )
}

/** Claude usage in the sidebar title bar: rings + session %, details on click. */
export function UsageMenu() {
  const usage = useStore((s) => s.usage)
  const now = useNow()
  const [open, setOpen] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  const limited = usage?.status === 'rejected'
  const five = usage?.fiveHour ?? NONE
  const week = usage?.sevenDay ?? NONE
  // If we don't know which window hit the limit, show it on the session window.
  const weekLimited = limited && usage?.limitedWindow === 'seven_day'
  const fiveLimited = limited && !weekLimited
  const fiveLevel = usageLevel(five, fiveLimited)
  const weekLevel = usageLevel(week, weekLimited)

  const refresh = (): void => {
    setRefreshing(true)
    void api.refreshUsage().finally(() => setRefreshing(false))
  }

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const summary = `Claude usage: session ${fiveLimited ? 'limit reached' : pct(five.utilization)}, week ${weekLimited ? 'limit reached' : pct(week.utilization)}`

  return (
    // Not `relative`: the panel is positioned against the (relative) title bar so it stays inside the sidebar.
    <div ref={root} className="no-drag">
      <button
        type="button"
        onClick={() => {
          if (!open) refresh()
          setOpen(!open)
        }}
        aria-label={summary}
        aria-expanded={open}
        title={open ? undefined : summary}
        className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-1.5 transition hover:bg-hover ${open ? 'bg-hover' : ''}`}
      >
        <Rings
          session={fiveLimited ? 1 : five.utilization}
          week={weekLimited ? 1 : week.utilization}
          sessionColor={ringColor(fiveLevel, SESSION_HUE)}
          weekColor={ringColor(weekLevel, WEEK_HUE)}
        />
        <span
          className="min-w-[2.2em] text-left text-[12px] font-semibold tabular-nums"
          style={{ color: fiveLevel === 'warn' || fiveLevel === 'high' ? LEVEL_COLOR[fiveLevel] : 'var(--muted)' }}
        >
          {fiveLimited ? '100%' : pct(five.utilization)}
        </span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Claude usage"
          className="pop absolute top-full right-3 z-50 -mt-1 w-64 rounded-xl border border-line bg-bg p-3.5 shadow-2xl"
        >
          <div className="mb-3 flex items-center">
            <span className="text-[13px] font-semibold">Claude usage</span>
            <button
              type="button"
              onClick={refresh}
              disabled={refreshing}
              aria-label="Refresh usage"
              title="Refresh"
              className="ml-auto inline-flex h-6 w-6 items-center justify-center rounded-md text-muted transition hover:bg-hover hover:text-fg disabled:opacity-60"
            >
              <RefreshIcon size={13} className={refreshing ? 'animate-spin' : ''} />
            </button>
          </div>
          <div className="space-y-3.5">
            <WindowRow title="5-hour session" hue={SESSION_HUE} window={five} limited={fiveLimited} now={now} />
            <WindowRow title="This week" hue={WEEK_HUE} window={week} limited={weekLimited} now={now} />
          </div>
          <div className="mt-3 border-t border-line pt-2 text-[11px] leading-snug text-muted">
            Includes Claude Code and claude.ai.{usage ? ` Updated ${ago(usage.updatedAt, now)}.` : ''}
          </div>
        </div>
      )}
    </div>
  )
}
