// Routines: one node-cron task per agent with an enabled routine. Runs only
// while NateBot is running (window or menu bar) and the Mac is awake.
import cron, { type ScheduledTask } from 'node-cron'
import type { AgentConfig } from '@shared/types'

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
