import { useCallback, useEffect, useState } from 'react'
import type { Reminder, RoutineInfo } from '@shared/types'
import { describeCron } from '@shared/schedule'
import { api, useStore } from '../lib/store'
import { dueTime, listTime, relativeFuture } from '../lib/format'
import { agentPicture } from '../lib/avatars'
import { Avatar } from './Avatar'
import { PlayIcon, PlusIcon, XIcon } from './icons'
import { Button, Toggle } from './ui'

export function RoutinesView() {
  const agents = useStore((s) => s.agents)
  const [routines, setRoutines] = useState<RoutineInfo[] | null>(null)
  const [reminders, setReminders] = useState<Reminder[]>([])

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
              <div key={`${r.agentId}#${r.routine.id}`} className="flex items-center gap-4 rounded-2xl bg-elev/60 px-4 py-3.5">
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
                    <div className={`mt-0.5 truncate text-[12px] ${r.lastRun.ok ? 'text-muted' : 'text-danger'}`}>
                      Last run {listTime(r.lastRun.at)}: {r.lastRun.ok ? '✓' : '✗'} {r.lastRun.summary}
                    </div>
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
