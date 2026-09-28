import { useCallback, useEffect, useState } from 'react'
import type { RoutineInfo } from '@shared/types'
import { describeCron } from '@shared/schedule'
import { api, useStore } from '../lib/store'
import { listTime, relativeFuture } from '../lib/format'
import { agentPicture } from '../lib/avatars'
import { Avatar } from './Avatar'
import { PlayIcon, PlusIcon } from './icons'
import { Button, Toggle } from './ui'

export function RoutinesView() {
  const agents = useStore((s) => s.agents)
  const [routines, setRoutines] = useState<RoutineInfo[] | null>(null)

  const load = useCallback(() => {
    void api.listRoutines().then(setRoutines)
  }, [])

  // Agents changing (toggles, runs finishing) can change routine info.
  useEffect(load, [agents, load])

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="drag flex h-[52px] shrink-0 items-center border-b border-line px-6">
        <div className="text-[15px] font-semibold">Routines</div>
      </header>
      <div className="flex-1 overflow-y-auto px-6 py-5">
        <div className="mx-auto max-w-[760px]">
          <p className="mb-4 text-[13px] text-muted">
            Routines run while NateBot is open (or in the menu bar) and your Mac is awake. They count toward your
            Claude usage like normal messages.
          </p>

          {routines && routines.length === 0 && (
            <div className="rounded-2xl border border-dashed border-line p-8 text-center text-[13px] text-muted">
              No routines yet. Open an agent's settings and switch on “Routine”.
            </div>
          )}

          <div className="space-y-2">
            {routines?.map((r) => (
              <div key={r.agentId} className="flex items-center gap-4 rounded-2xl bg-elev/60 px-4 py-3.5">
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
                <Button onClick={() => void api.runRoutineNow(r.agentId)} title="Run now">
                  <PlayIcon size={12} /> Run now
                </Button>
                <Toggle
                  label={`${r.agentName} routine`}
                  checked={r.routine.enabled}
                  onChange={(v) => void api.setRoutineEnabled(r.agentId, v)}
                />
              </div>
            ))}
          </div>

          <div className="mt-4">
            <Button variant="ghost" onClick={() => useStore.getState().setAddOpen(true)}>
              <PlusIcon size={14} /> New agent with a routine
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
