import { useCallback, useEffect, useState } from 'react'
import type { Reminder, RoutineInfo, RoutineRun } from '@shared/types'
import { describeCron } from '@shared/schedule'
import { api, useStore } from '../lib/store'
import { dueTime, listTime, relativeFuture } from '../lib/format'
import { agentPicture } from '../lib/avatars'
import { Avatar } from './Avatar'
import { ChevronIcon, PlayIcon, PlusIcon, XIcon } from './icons'
import { Button, Toggle } from './ui'

const tokenText = (n: number): string => (n >= 1000 ? `${Math.round(n / 1000)}k tokens` : `${n} tokens`)

/** A routine's last runs, newest first; a click opens the reply it produced. */
function RoutineHistory({ agentId, routineId, lastAt }: { agentId: string; routineId: string; lastAt: number | null }) {
  const [runs, setRuns] = useState<RoutineRun[] | null>(null)
  useEffect(() => {
    let live = true
    void api.routineHistory(agentId, routineId).then((r) => live && setRuns(r))
    return () => {
      live = false
    }
  }, [agentId, routineId, lastAt])

  if (!runs) return null
  if (!runs.length) return <div className="mt-2 text-[12px] text-muted">No runs yet.</div>
  const failed = runs.filter((r) => !r.ok).length
  return (
    <div className="mt-2 rounded-xl bg-elev px-1 py-1">
      <div className="px-2 pt-1 pb-1.5 text-[11px] text-muted">
        Last {runs.length} run{runs.length > 1 ? 's' : ''}
        {failed ? ` · ${failed} failed` : ''}
      </div>
      {runs.map((run, i) => (
        <button
          key={i}
          type="button"
          disabled={!run.messageId}
          onClick={() => run.messageId && useStore.getState().openMessage(agentId, run.messageId)}
          className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] enabled:hover:bg-hover"
        >
          <span className={run.ok ? 'text-success' : 'text-danger'}>{run.ok ? '✓' : '✗'}</span>
          <span className="w-[120px] shrink-0 text-muted">{listTime(run.at)}</span>
          <span className="min-w-0 flex-1 truncate">{run.summary || (run.ok ? 'Done' : 'Failed')}</span>
          {run.tokens !== null && <span className="shrink-0 text-[11px] text-muted">{tokenText(run.tokens)}</span>}
        </button>
      ))}
    </div>
  )
}

export function RoutinesView() {
  const agents = useStore((s) => s.agents)
  const [routines, setRoutines] = useState<RoutineInfo[] | null>(null)
  const [reminders, setReminders] = useState<Reminder[]>([])
  /** Routines whose history is showing ("agentId#routineId"). */
  const [open, setOpen] = useState<Set<string>>(new Set())
  const toggle = (key: string): void => {
    const next = new Set(open)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    setOpen(next)
  }

  const load = useCallback(() => {
    void api.listRoutines().then(setRoutines)
    void api.listReminders().then(setReminders)
  }, [])

  // Agents changing (toggles, runs finishing) can change routine info.
  useEffect(load, [agents, load])

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="drag flex h-[52px] shrink-0 items-center border-b border-line px-6">
        <div className="text-[15px] font-semibold">Routines &amp; reminders</div>
      </header>
      <div className="flex-1 overflow-y-auto px-6 py-5">
        <div className="mx-auto max-w-[760px]">
          <p className="mb-4 text-[13px] text-muted">
            Routines run while NateBot is open (or in the menu bar) and your Mac is awake. They count toward your
            Claude usage like normal messages.
          </p>

          {routines && routines.length === 0 && (
            <div className="rounded-2xl border border-dashed border-line p-8 text-center text-[13px] text-muted">
              No routines yet. Open an agent's settings and add one under “Routines”.
            </div>
          )}

          <div className="space-y-2">
            {routines?.map((r) => (
              <div key={`${r.agentId}#${r.routine.id}`} className="rounded-2xl bg-elev/60 px-4 py-3.5">
                <div className="flex items-center gap-4">
                  <Avatar seed={r.agentName} shape={r.shape} color={r.color} picture={agentPicture(r.agentId, r.avatarVersion)} size={40} />
                  <div className="min-w-0 flex-1">
                    <button
                      type="button"
                      onClick={() => useStore.getState().select(r.agentId)}
                      className="text-[14px] font-semibold hover:underline"
                    >
                      {r.agentName}
                    </button>
                    <div className="text-[12px] text-muted">
                      {describeCron(r.routine.cron)}
                      {r.routine.enabled && r.nextRun ? ` · next ${relativeFuture(r.nextRun)}` : ''}
                      {!r.routine.enabled && ' · off'}
                    </div>
                    <div className="mt-1 truncate text-[13px]">“{r.routine.prompt}”</div>
                    {r.lastRun && (
                      <button
                        type="button"
                        onClick={() => toggle(`${r.agentId}#${r.routine.id}`)}
                        className={`mt-0.5 flex max-w-full items-center gap-1 truncate text-left text-[12px] hover:underline ${r.lastRun.ok ? 'text-muted' : 'text-danger'}`}
                        title="Show recent runs"
                      >
                        <ChevronIcon size={11} className={`shrink-0 transition-transform ${open.has(`${r.agentId}#${r.routine.id}`) ? 'rotate-90' : ''}`} />
                        <span className="truncate">
                          Last run {listTime(r.lastRun.at)}: {r.lastRun.ok ? '✓' : '✗'} {r.lastRun.summary}
                        </span>
                      </button>
                    )}
                  </div>
                  <Button onClick={() => void api.runRoutineNow(r.agentId, r.routine.id)} title="Run now">
                    <PlayIcon size={12} /> Run now
                  </Button>
                  <Toggle
                    label={`${r.agentName} routine`}
                    checked={r.routine.enabled}
                    onChange={(v) => void api.setRoutineEnabled(r.agentId, r.routine.id, v)}
                  />
                </div>
                {open.has(`${r.agentId}#${r.routine.id}`) && <RoutineHistory agentId={r.agentId} routineId={r.routine.id} lastAt={r.lastRun?.at ?? null} />}
              </div>
            ))}
          </div>

          <div className="mt-4">
            <Button variant="ghost" onClick={() => useStore.getState().setAddOpen(true)}>
              <PlusIcon size={14} /> New agent with a routine
            </Button>
          </div>

          <h2 className="mt-8 mb-1 text-[14px] font-semibold">Reminders</h2>
          <p className="mb-3 text-[13px] text-muted">
            One-off reminders your agents set when you ask, like “remind me at 7pm to call Mum”.
          </p>
          {reminders.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-line p-6 text-center text-[13px] text-muted">
              No reminders coming up. Ask any agent to remind you about something.
            </div>
          ) : (
            <div className="space-y-2">
              {reminders.map((r) => {
                const agent = agents.find((a) => a.id === r.agentId)
                return (
                  <div key={r.id} className="flex items-center gap-4 rounded-2xl bg-elev/60 px-4 py-3">
                    <Avatar
                      seed={agent?.name ?? '?'}
                      shape={agent?.shape}
                      color={agent?.color}
                      picture={agent ? agentPicture(agent.id, agent.avatarVersion) : null}
                      size={32}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-[12px] text-muted">
                        {dueTime(r.at)} · {agent?.name}
                        {r.kind === 'task' ? ' will work on it' : ''}
                        {r.repeat ? ` · repeats ${r.repeat === 'weekdays' ? 'on weekdays' : r.repeat}` : ''}
                      </div>
                      <div className="truncate text-[13px]">{r.text}</div>
                    </div>
                    <Button variant="ghost" onClick={() => void api.cancelReminder(r.id).then(load)}>
                      <XIcon size={12} /> Cancel
                    </Button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
