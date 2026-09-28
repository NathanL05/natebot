// Tracks the subscription usage windows from claude's rate_limit_event and
// decides when runs must wait for the limit to reset. The last known state is
// kept in ~/NateBot/usage.json so the widget has numbers right after launch.
import { EventEmitter } from 'node:events'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { UsageInfo, UsageWindow } from '@shared/types'
import type { RateLimitInfo } from './claude/stream'
import { ROOT } from './paths'

const LIMIT_TEXT = /usage limit|limit reached|rate.?limit|out of (extra )?usage|5-hour limit|weekly limit/i
const FALLBACK_WAIT = 15 * 60_000
const FILE = join(ROOT, 'usage.json')

export function looksLikeUsageLimit(text: string): boolean {
  return LIMIT_TEXT.test(text)
}

/** Best effort: "…limit reached|1790599200" style epoch seconds in error text. */
function resetFromText(text: string): number | null {
  const epoch = /\|(\d{10})\b/.exec(text)?.[1]
  return epoch ? Number(epoch) * 1000 : null
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

  constructor() {
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
      if (fiveHour !== this.info.fiveHour || sevenDay !== this.info.sevenDay) this.info = { ...this.info, fiveHour, sevenDay }
    }
    return this.info
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
