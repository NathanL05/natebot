import type { UsageWindow } from '@shared/types'

export type UsageLevel = 'none' | 'ok' | 'warn' | 'high'

/** Neutral below 60%, amber from 60%, red from 85% (or when the limit is hit). */
export function usageLevel(w: UsageWindow, limited = false): UsageLevel {
  if (limited) return 'high'
  if (w.utilization === null) return 'none'
  if (w.utilization >= 0.85) return 'high'
  if (w.utilization >= 0.6) return 'warn'
  return 'ok'
}

export const LEVEL_COLOR: Record<UsageLevel, string> = {
  none: 'var(--muted)',
  ok: 'var(--text)',
  warn: 'var(--warn)',
  high: 'var(--danger)'
}

export const pct = (u: number | null, digits = 0): string => (u === null ? '—' : `${(u * 100).toFixed(digits)}%`)

/** "43m", "2h 13m", "3d 4h" */
export function countdown(until: number | null, now = Date.now()): string | null {
  if (!until) return null
  const mins = Math.max(0, Math.round((until - now) / 60_000))
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ${mins % 60}m`
  return `${Math.floor(hours / 24)}d ${hours % 24}h`
}

export function resetTime(until: number): string {
  const d = new Date(until)
  const sameDay = d.toDateString() === new Date().toDateString()
  return sameDay
    ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
}

export function ago(ts: number, now = Date.now()): string {
  const mins = Math.round((now - ts) / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hours = Math.round(mins / 60)
  return hours < 24 ? `${hours} h ago` : `${Math.round(hours / 24)} d ago`
}
