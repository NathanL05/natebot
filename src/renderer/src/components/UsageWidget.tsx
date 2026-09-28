import { useEffect, useState } from 'react'
import type { UsageInfo, UsageWindow } from '@shared/types'
import { useStore } from '../lib/store'
import { ago, countdown, LEVEL_COLOR, pct, resetTime, usageLevel } from '../lib/usage'

/** Re-render every 30 s so countdowns stay current. */
function useNow(): number {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])
  return now
}

export function Ring({ value, color, size = 18 }: { value: number | null; color: string; size?: number }) {
  const r = (size - 3) / 2
  const c = 2 * Math.PI * r
  const filled = value === null ? 0 : Math.min(1, Math.max(0, value))
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0 -rotate-90" aria-hidden="true">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--elev-2)" strokeWidth="3" />
      {filled > 0 && (
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={`${Math.max(filled * c, 0.01)} ${c}`}
          style={{ transition: 'stroke-dasharray 0.4s ease, stroke 0.4s ease' }}
        />
      )}
    </svg>
  )
}

interface WindowProps {
  label: string
  long: string
  window: UsageWindow
  limited: boolean
  usage: UsageInfo | null
  now: number
}

function UsageItem({ label, long, window: w, limited, usage, now }: WindowProps) {
  const [hover, setHover] = useState(false)
  const level = usageLevel(w, limited)
  const color = LEVEL_COLOR[level]
  const left = countdown(w.resetsAt, now)
  const sub = limited ? `limit · ${left ?? 'soon'}` : left ? `resets ${left}` : w.utilization === null ? 'no data yet' : 'window not started'

  return (
    <div
      className="relative flex min-w-0 flex-1 cursor-default items-center gap-2 rounded-lg px-1.5 py-1 outline-none hover:bg-hover focus-visible:bg-hover"
      tabIndex={0}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setHover(true)}
      onBlur={() => setHover(false)}
      aria-label={`${long}: ${pct(w.utilization)} used, ${sub}`}
    >
      <Ring value={limited ? 1 : w.utilization} color={color} />
      <div className="min-w-0 leading-tight">
        <div className="flex items-baseline gap-1 text-[11px]">
          <span className="text-muted">{label}</span>
          <span className="font-semibold tabular-nums" style={{ color: level === 'ok' || level === 'none' ? undefined : color }}>
            {limited ? '100%' : pct(w.utilization)}
          </span>
        </div>
        <div className={`truncate text-[10.5px] tabular-nums ${limited ? 'text-danger' : 'text-muted'}`}>{sub}</div>
      </div>

      {hover && (
        <div
          role="tooltip"
          className="pop pointer-events-none absolute bottom-full left-0 z-50 mb-2 w-60 rounded-xl border border-line bg-bg px-3 py-2.5 text-[12px] shadow-2xl"
        >
          <div className="font-semibold">{long}</div>
          {w.utilization === null && !limited ? (
            <div className="mt-1 text-muted">Numbers appear after your first message in NateBot.</div>
          ) : (
            <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
              <dt className="text-muted">Used</dt>
              <dd className="text-right font-medium tabular-nums">{limited ? 'Limit reached' : pct(w.utilization, 1)}</dd>
              <dt className="text-muted">Left</dt>
              <dd className="text-right tabular-nums">{limited || w.utilization === null ? '0%' : pct(Math.max(0, 1 - w.utilization), 1)}</dd>
              <dt className="text-muted">Resets</dt>
              <dd className="text-right tabular-nums">{w.resetsAt ? `${resetTime(w.resetsAt)} (in ${left})` : 'when you next use it'}</dd>
            </dl>
          )}
          {usage && <div className="mt-1.5 border-t border-line pt-1.5 text-[11px] text-muted">Updated {ago(usage.updatedAt, now)}</div>}
        </div>
      )}
    </div>
  )
}

/** Compact session + weekly usage for the sidebar. */
export function UsageWidget() {
  const usage = useStore((s) => s.usage)
  const now = useNow()
  const limited = usage?.status === 'rejected'
  const five = usage?.fiveHour ?? { utilization: null, resetsAt: null }
  const week = usage?.sevenDay ?? { utilization: null, resetsAt: null }
  // If we don't know which window hit the limit, show it on the session window.
  const weekLimited = limited && usage?.limitedWindow === 'seven_day'
  const fiveLimited = limited && !weekLimited

  return (
    <div className="flex gap-1 px-2 pb-1.5" aria-label="Claude usage">
      <UsageItem label="Session" long="5-hour session window" window={five} limited={fiveLimited} usage={usage} now={now} />
      <UsageItem label="Week" long="Weekly limit" window={week} limited={weekLimited} usage={usage} now={now} />
    </div>
  )
}
