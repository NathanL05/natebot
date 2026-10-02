// Routines: one node-cron task per agent with an enabled routine. Runs only
// while NateBot is running (window or menu bar) and the Mac is awake, so on
// launch and on wake the backend catches up on a recently missed run.
import cron, { type ScheduledTask } from 'node-cron'
import type { AgentConfig } from '@shared/types'
import { lastOccurrence } from '@shared/schedule'

/** How long a missed routine is still worth running late. */
export const CATCH_UP_WINDOW = 12 * 60 * 60_000

/** A routine's scheduled times up to `at` have been dealt with (run or skipped), for this cron. */
export interface Checkpoint {
  cron: string
  at: number
}

/**
 * The scheduled time a routine should run for now, or null if there's nothing to do.
 * 'tick': node-cron fired (late, if the Mac just woke). 'catch-up': NateBot started or the
 * Mac woke. Either way a scheduled time runs at most once, and only the latest missed one.
 */
export function dueRun(cronExpr: string, checkpoint: Checkpoint | null, now: number, trigger: 'tick' | 'catch-up'): number | null {
  const due = lastOccurrence(cronExpr, now, CATCH_UP_WINDOW)
  // A cron node-cron accepts but the matcher doesn't (e.g. day names): run on ticks as before.
  if (due === null) return trigger === 'tick' ? now : null
  const known = checkpoint?.cron === cronExpr ? checkpoint : null
  if (known && known.at >= due) return null
  // Without a checkpoint for this cron there's no telling what was missed.
  if (!known && trigger === 'catch-up') return null
  return due
}

export class Scheduler {
  private tasks = new Map<string, { cron: string; task: ScheduledTask }>()

  constructor(private onFire: (agentId: string) => void) {}

  /** Makes the scheduled tasks match the agents' current routines. */
  sync(agents: AgentConfig[]): void {
    const wanted = new Map<string, string>()
    for (const a of agents) {
      if (a.routine?.enabled && cron.validate(a.routine.cron)) wanted.set(a.id, a.routine.cron)
    }
    for (const [id, entry] of this.tasks) {
      if (wanted.get(id) !== entry.cron) {
        void entry.task.destroy()
        this.tasks.delete(id)
      }
    }
    for (const [id, expr] of wanted) {
      if (this.tasks.has(id)) continue
      const task = cron.schedule(expr, () => this.onFire(id), { name: `routine:${id}`, noOverlap: true })
      this.tasks.set(id, { cron: expr, task })
    }
  }

  nextRun(agentId: string): number | null {
    return this.tasks.get(agentId)?.task.getNextRun()?.getTime() ?? null
  }

  stopAll(): void {
    for (const { task } of this.tasks.values()) void task.destroy()
    this.tasks.clear()
  }
}
