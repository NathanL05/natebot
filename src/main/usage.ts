// Tracks the subscription usage window from claude's rate_limit_event and
// decides when runs must wait for the limit to reset.
import { EventEmitter } from 'node:events'
import type { UsageInfo } from '@shared/types'
import type { RateLimitInfo } from './claude/stream'

const LIMIT_TEXT = /usage limit|limit reached|rate.?limit|out of (extra )?usage|5-hour limit|weekly limit/i
const FALLBACK_WAIT = 15 * 60_000

export function looksLikeUsageLimit(text: string): boolean {
  return LIMIT_TEXT.test(text)
}

/** Best effort: "…limit reached|1790599200" style epoch seconds in error text. */
function resetFromText(text: string): number | null {
  const epoch = /\|(\d{10})\b/.exec(text)?.[1]
  return epoch ? Number(epoch) * 1000 : null
}

export class UsageTracker extends EventEmitter {
  private info: UsageInfo | null = null
  private blockedUntil = 0

  get(): UsageInfo | null {
    return this.info
  }

  update(r: RateLimitInfo): void {
    const five = r.unifiedWindows?.['five_hour']
    const seven = r.unifiedWindows?.['seven_day']
    const resetsAt = r.resetsAt ? r.resetsAt * 1000 : (this.info?.resetsAt ?? null)
    this.info = {
      status: r.status ?? 'allowed',
      resetsAt,
      fiveHourUtilization: typeof five?.utilization === 'number' ? five.utilization : (this.info?.fiveHourUtilization ?? null),
      sevenDayUtilization: typeof seven?.utilization === 'number' ? seven.utilization : (this.info?.sevenDayUtilization ?? null),
      updatedAt: Date.now()
    }
    if (r.status === 'rejected') this.blockedUntil = resetsAt ?? Date.now() + FALLBACK_WAIT
    else this.blockedUntil = 0
    this.emit('changed', this.info)
  }

  /** Called when a run fails with a usage-limit error. */
  markLimited(errorText: string): void {
    const resetsAt = resetFromText(errorText) ?? this.info?.resetsAt ?? null
    const until = resetsAt && resetsAt > Date.now() ? resetsAt : Date.now() + FALLBACK_WAIT
    this.blockedUntil = until
    this.info = {
      status: 'rejected',
      resetsAt: until,
      fiveHourUtilization: this.info?.fiveHourUtilization ?? null,
      sevenDayUtilization: this.info?.sevenDayUtilization ?? null,
      updatedAt: Date.now()
    }
    this.emit('changed', this.info)
  }

  /** Dev-only simulation from the Debug menu. */
  simulate(on: boolean): void {
    if (on) this.markLimited('simulated')
    else {
      this.blockedUntil = 0
      if (this.info) this.info = { ...this.info, status: 'allowed', updatedAt: Date.now() }
      this.emit('changed', this.info)
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
      this.emit('changed', this.info)
    }
    return 0
  }
}
