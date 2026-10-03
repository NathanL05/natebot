// Routines: one node-cron task per enabled routine (an agent can have several). Runs only
// while NateBot is running (window or menu bar) and the Mac is awake, so on
// launch and on wake the backend catches up on a recently missed run.
import cron, { type ScheduledTask } from 'node-cron'
import type { AgentConfig, Routine } from '@shared/types'
import { describeCron, lastOccurrence } from '@shared/schedule'

/** How long a missed routine is still worth running late. */
export const CATCH_UP_WINDOW = 12 * 60 * 60_000

/** A routine's scheduled times up to `at` have been dealt with (run or skipped), for this cron. */
export interface Checkpoint {
  cron: string
  at: number
}

/**
 * The checkpoint a routine should have after its settings are saved: none while it's
 * off, and a new or changed schedule starts counting from now, so a catch-up never
 * runs a time from before it was set up. Returns `current` itself when nothing changes.
 */
export function syncedCheckpoint(routine: Routine | null, current: Checkpoint | null, now: number): Checkpoint | null {
  if (!routine?.enabled) return null
  return current?.cron === routine.cron ? current : { cron: routine.cron, at: now }
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

/** Chat lines for what changed in an agent's routines when its settings are saved. */
export function routineChanges(before: Routine[], after: Routine[]): string[] {
  const lines: string[] = []
  for (const r of after) {
    const old = before.find((b) => b.id === r.id)
    if (r.enabled && !old?.enabled) lines.push(`Created routine: ${describeCron(r.cron)}`)
    else if (r.enabled && (old?.cron !== r.cron || old?.prompt !== r.prompt)) lines.push(`Routine updated: ${describeCron(r.cron)}`)
    else if (!r.enabled && old?.enabled) lines.push(`Routine turned off: ${describeCron(r.cron)}`)
  }
  for (const b of before) if (b.enabled && !after.some((r) => r.id === b.id)) lines.push(`Routine removed: ${describeCron(b.cron)}`)
  return lines
}

const key = (agentId: string, routineId: string): string => `${agentId}#${routineId}`

export class Scheduler {
  private tasks = new Map<string, { cron: string; task: ScheduledTask }>()

  constructor(private onFire: (agentId: string, routineId: string) => void) {}

  /** Makes the scheduled tasks match the agents' current routines. */
  sync(agents: AgentConfig[]): void {
    const wanted = new Map<string, { agentId: string; routineId: string; cron: string }>()
    for (const a of agents) {
      for (const r of a.routines) {
        if (r.enabled && cron.validate(r.cron)) wanted.set(key(a.id, r.id), { agentId: a.id, routineId: r.id, cron: r.cron })
      }
    }
    for (const [k, entry] of this.tasks) {
      if (wanted.get(k)?.cron !== entry.cron) {
        void entry.task.destroy()
        this.tasks.delete(k)
      }
    }
    for (const [k, w] of wanted) {
      if (this.tasks.has(k)) continue
      const task = cron.schedule(w.cron, () => this.onFire(w.agentId, w.routineId), { name: `routine:${k}`, noOverlap: true })
      this.tasks.set(k, { cron: w.cron, task })
    }
  }

  nextRun(agentId: string, routineId: string): number | null {
    return this.tasks.get(key(agentId, routineId))?.task.getNextRun()?.getTime() ?? null
  }

  stopAll(): void {
    for (const { task } of this.tasks.values()) void task.destroy()
    this.tasks.clear()
  }
}
