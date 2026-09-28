// Tracks the subscription usage windows and decides when runs must wait for
// the limit to reset. Numbers come from claude's rate_limit_event during runs
// and from polling `claude -p /usage`, which answers locally (no tokens) and
// also counts usage from Claude Code itself. The last known state is kept in
// ~/NateBot/usage.json so the widget has numbers right after launch.
import { execFile } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { UsageInfo, UsageWindow } from '@shared/types'
import type { RateLimitInfo } from './claude/stream'
import { childEnv } from './env'
import { log } from './log'
import { ROOT } from './paths'

const LIMIT_TEXT = /usage limit|limit reached|rate.?limit|out of (extra )?usage|5-hour limit|weekly limit/i
const FALLBACK_WAIT = 15 * 60_000
const POLL_EVERY = 5 * 60_000
const MIN_REFRESH_GAP = 20_000
const DAY = 86_400_000
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const FILE = join(ROOT, 'usage.json')

export function looksLikeUsageLimit(text: string): boolean {
  return LIMIT_TEXT.test(text)
}

/** Best effort: "…limit reached|1790599200" style epoch seconds in error text. */
function resetFromText(text: string): number | null {
  const epoch = /\|(\d{10})\b/.exec(text)?.[1]
  return epoch ? Number(epoch) * 1000 : null
}

/**
 * A reset time from `/usage` (run with TZ=UTC): "Sep 28 at 5:40pm",
 * "Sep 29 at 8pm", "5:40pm" or "in 2h 13m".
 */
export function parseReset(text: string, now = Date.now()): number | null {
  const rel = /\bin\s+(?:(\d+)\s*d)?\s*(?:(\d+)\s*h)?\s*(?:(\d+)\s*m)?/i.exec(text)
  if (rel && (rel[1] || rel[2] || rel[3])) {
    return now + ((Number(rel[1] ?? 0) * 24 + Number(rel[2] ?? 0)) * 60 + Number(rel[3] ?? 0)) * 60_000
  }
  const m = /(?:([a-z]{3})[a-z]*\.?\s+(\d{1,2})\s*(?:at|,)?\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i.exec(text)
  if (!m) return null
  const [, mon, day, h, min, ampm] = m
  const today = new Date(now)
  const month = mon ? MONTHS.indexOf(mon.toLowerCase()) : today.getUTCMonth()
  if (month < 0) return null
  const hour = (Number(h) % 12) + ((ampm as string).toLowerCase() === 'pm' ? 12 : 0)
  const at = (year: number): number =>
    Date.UTC(year, month, mon ? Number(day) : today.getUTCDate(), hour, Number(min ?? 0))
  let t = at(today.getUTCFullYear())
  if (!mon && t < now) t += DAY // time only: the next occurrence
  if (mon && t < now - 30 * DAY) t = at(today.getUTCFullYear() + 1) // "Jan 2" seen in late December
  return t
}

/** The session and weekly windows from `/usage` output, or null if it didn't have them. */
export function parseUsageText(text: string, now = Date.now()): { fiveHour: UsageWindow; sevenDay: UsageWindow } | null {
  const lines = text.split('\n')
  const windowFrom = (...labels: RegExp[]): UsageWindow | null => {
    for (const label of labels) {
      const line = lines.find((l) => label.test(l))
      const used = line && /(\d+(?:\.\d+)?)\s*%/.exec(line)
      if (!line || !used) continue
      const reset = /resets\s+(.+?)\s*(?:\(|$)/i.exec(line)
      return { utilization: Math.min(1, Number(used[1]) / 100), resetsAt: reset ? parseReset(reset[1] as string, now) : null }
    }
    return null
  }
  const fiveHour = windowFrom(/current session/i)
  const sevenDay = windowFrom(/current week \(all models\)/i, /current week/i)
  return fiveHour && sevenDay ? { fiveHour, sevenDay } : null
}

const empty = (): UsageWindow => ({ utilization: null, resetsAt: null })

function toWindow(raw: { utilization?: number; resetsAt?: number } | undefined, prev: UsageWindow): UsageWindow {
  return {
    utilization: typeof raw?.utilization === 'number' ? raw.utilization : prev.utilization,
    resetsAt: typeof raw?.resetsAt === 'number' ? raw.resetsAt * 1000 : prev.resetsAt
  }
}

/** A window whose reset time has passed starts again from zero. */
function rollOver(w: UsageWindow): UsageWindow {
  return w.resetsAt && w.resetsAt <= Date.now() ? { utilization: 0, resetsAt: null } : w
}

export class UsageTracker extends EventEmitter {
  private info: UsageInfo | null = null
  private blockedUntil = 0
  private refreshing: Promise<void> | null = null
  private lastRefresh = 0
  private pollTimer: NodeJS.Timeout | undefined

  /** claudePath: the CLI to ask for `/usage`, or null while it isn't set up. */
  constructor(private claudePath: () => string | null = () => null) {
    super()
    try {
      const saved = JSON.parse(readFileSync(FILE, 'utf8')) as UsageInfo
      if (saved && saved.fiveHour && saved.sevenDay) {
        this.info = { ...saved, status: 'allowed', fiveHour: rollOver(saved.fiveHour), sevenDay: rollOver(saved.sevenDay) }
      }
    } catch {
      // No saved usage yet.
    }
  }

  get(): UsageInfo | null {
    if (this.info) {
      const fiveHour = rollOver(this.info.fiveHour)
      const sevenDay = rollOver(this.info.sevenDay)
      if (fiveHour !== this.info.fiveHour || sevenDay !== this.info.sevenDay) {
        this.info = { ...this.info, fiveHour, sevenDay }
        // A new window may already have started elsewhere (e.g. in Claude Code).
        void this.refresh()
      }
    }
    return this.info
  }

  /** Polls `/usage` now and every few minutes. */
  startPolling(): void {
    if (this.pollTimer) return
    void this.refresh(true)
    this.pollTimer = setInterval(() => void this.refresh(true), POLL_EVERY)
    this.pollTimer.unref()
  }

  stopPolling(): void {
    clearInterval(this.pollTimer)
    this.pollTimer = undefined
  }

  /**
   * Asks the CLI for current usage. `/usage` is a local command: it costs no
   * tokens and covers usage from Claude Code and claude.ai too, not just
   * NateBot's own runs. Throttled unless forced.
   */
  refresh(force = false): Promise<void> {
    if (this.refreshing) return this.refreshing
    const bin = this.claudePath()
    if (!bin || (!force && Date.now() - this.lastRefresh < MIN_REFRESH_GAP)) return Promise.resolve()
    this.lastRefresh = Date.now()
    this.refreshing = new Promise<void>((resolve) => {
      const child = execFile(
        bin,
        ['-p', '/usage', '--output-format', 'json', '--no-session-persistence', '--strict-mcp-config'],
        // TZ=UTC so reset times come back in a timezone we can parse.
        { cwd: ROOT, env: { ...childEnv(), TZ: 'UTC' }, timeout: 30_000, maxBuffer: 1024 * 1024 },
        (err, stdout) => {
          const text = (() => {
            try {
              const result = (JSON.parse(stdout) as { result?: unknown }).result
              return typeof result === 'string' ? result : ''
            } catch {
              return ''
            }
          })()
          const parsed = parseUsageText(text)
          if (parsed) this.applySnapshot(parsed.fiveHour, parsed.sevenDay)
          else log(`usage: /usage gave no numbers${err ? ` (${err.message.split('\n')[0]})` : ''}: ${text.slice(0, 200)}`)
          resolve()
        }
      )
      child.stdin?.end()
    }).finally(() => {
      this.refreshing = null
    })
    return this.refreshing
  }

  private applySnapshot(fiveHour: UsageWindow, sevenDay: UsageWindow): void {
    const prev = this.info
    let status = prev?.status ?? 'allowed'
    let limitedWindow = prev?.limitedWindow ?? null
    if (status === 'rejected') {
      const full = (w: UsageWindow): boolean => (w.utilization ?? 0) >= 1
      const stillLimited =
        limitedWindow === 'seven_day' ? full(sevenDay) : limitedWindow ? full(fiveHour) : full(fiveHour) || full(sevenDay)
      if (!stillLimited) {
        status = 'allowed'
        limitedWindow = null
        this.blockedUntil = 0
      }
    }
    this.info = {
      status,
      limitedWindow,
      resetsAt: status === 'rejected' ? (prev?.resetsAt ?? null) : fiveHour.resetsAt,
      fiveHour,
      sevenDay,
      updatedAt: Date.now()
    }
    this.changed()
  }

  private changed(): void {
    try {
      writeFileSync(FILE, JSON.stringify(this.info))
    } catch {
      // Not fatal.
    }
    this.emit('changed', this.info)
  }

  update(r: RateLimitInfo): void {
    const prev = this.info
    const fiveHour = toWindow(r.unifiedWindows?.['five_hour'], prev?.fiveHour ?? empty())
    const sevenDay = toWindow(r.unifiedWindows?.['seven_day'], prev?.sevenDay ?? empty())
    const resetsAt = r.resetsAt ? r.resetsAt * 1000 : (prev?.resetsAt ?? null)
    this.info = {
      status: r.status ?? 'allowed',
      limitedWindow: r.status === 'rejected' ? (r.rateLimitType ?? null) : null,
      resetsAt,
      fiveHour,
      sevenDay,
      updatedAt: Date.now()
    }
    this.blockedUntil = r.status === 'rejected' ? (resetsAt ?? Date.now() + FALLBACK_WAIT) : 0
    this.changed()
  }

  /** Called when a run fails with a usage-limit error. */
  markLimited(errorText: string): void {
    const resetsAt = resetFromText(errorText) ?? this.info?.resetsAt ?? null
    const until = resetsAt && resetsAt > Date.now() ? resetsAt : Date.now() + FALLBACK_WAIT
    this.blockedUntil = until
    this.info = {
      status: 'rejected',
      limitedWindow: this.info?.limitedWindow ?? null,
      resetsAt: until,
      fiveHour: this.info?.fiveHour ?? empty(),
      sevenDay: this.info?.sevenDay ?? empty(),
      updatedAt: Date.now()
    }
    this.changed()
  }

  /** Dev-only simulation from the Debug menu. */
  simulate(on: boolean): void {
    if (on) this.markLimited('simulated')
    else {
      this.blockedUntil = 0
      if (this.info) this.info = { ...this.info, status: 'allowed', updatedAt: Date.now() }
      this.changed()
    }
  }

  /** ms to wait before runs may start again (0 = go ahead). */
  waitMs(): number {
    const wait = this.blockedUntil - Date.now()
    if (wait > 0) return wait
    if (this.blockedUntil && this.info?.status === 'rejected') {
      // Window has passed: optimistically allow; the next run reports fresh status.
      this.blockedUntil = 0
      this.info = { ...this.info, status: 'allowed', updatedAt: Date.now() }
      this.changed()
    }
    return 0
  }
}
