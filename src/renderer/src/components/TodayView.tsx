// Today: everything waiting for you across all agents, what's coming up, and what the
// routines found. Built from data NateBot already has, so it never runs Claude.
import { useCallback, useEffect, useState } from 'react'
import type { Agenda, ChatMessage, Reminder, RoutineInfo } from '@shared/types'
import { api, useStore } from '../lib/store'
import { agentPicture } from '../lib/avatars'
import { clockTime, dueTime, listTime } from '../lib/format'
import { ActionCard } from './ActionCard'
import { Avatar } from './Avatar'
import { HandoffCard } from './HandoffCard'
import { Markdown } from './Markdown'
import { CheckIcon } from './icons'
import { Button, ConfirmDialog } from './ui'

const DAY = 86_400_000

function greeting(name: string): string {
  const h = new Date().getHours()
  const part = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
  return `${part}, ${name.split(' ')[0] || name}`
}

export function TodayView() {
  const agents = useStore((s) => s.agents)
  const userName = useStore((s) => s.settings?.userName ?? '')
  const [pending, setPending] = useState<ChatMessage[]>([])
  const [reminders, setReminders] = useState<Reminder[]>([])
  const [routines, setRoutines] = useState<RoutineInfo[]>([])
  const [confirm, setConfirm] = useState(false)
  const [approving, setApproving] = useState(false)
  const [agenda, setAgenda] = useState<Agenda | null>(null)

  const load = useCallback(() => {
    void api.pendingMessages().then(setPending)
    void api.listReminders().then(setReminders)
    void api.listRoutines().then(setRoutines)
  }, [])
  // Agents change whenever a run finishes or something is approved, rejected or handed off.
  useEffect(load, [agents, load])
  useEffect(() => void api.todayAgenda().then(setAgenda), [])

  const byId = Object.fromEntries(agents.map((a) => [a.id, a]))
  const actions = pending.flatMap((m) => (m.actions ?? []).filter((a) => a.status === 'pending' && !a.auto).map((a) => ({ m, a })))
  const now = Date.now()
  const soon = reminders.filter((r) => r.at < now + 2 * DAY)
  const upcoming = routines.filter((r) => r.nextRun && r.nextRun < now + DAY).sort((a, b) => (a.nextRun ?? 0) - (b.nextRun ?? 0))
  const recent = routines.filter((r) => r.lastRun && r.lastRun.at > now - DAY).sort((a, b) => (b.lastRun?.at ?? 0) - (a.lastRun?.at ?? 0))

  const approveAll = async (): Promise<void> => {
    setConfirm(false)
    setApproving(true)
    try {
      // One at a time: each approved action is its own short run.
      for (const { m, a } of actions) await api.resolveAction(m.id, a.id, 'approve')
    } finally {
      setApproving(false)
      load()
    }
  }

  const who = (agentId: string) => {
    const a = byId[agentId]
    return (
      <button type="button" onClick={() => useStore.getState().select(agentId)} className="flex items-center gap-2 text-[13px] font-semibold hover:underline">
        <Avatar seed={a?.name ?? '?'} shape={a?.shape} color={a?.color} picture={a ? agentPicture(a.id, a.avatarVersion) : null} size={22} />
        {a?.name ?? 'Agent'}
      </button>
    )
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="drag flex h-[52px] shrink-0 items-center border-b border-line px-6">
        <div className="text-[15px] font-semibold">Today</div>
      </header>
      <div className="flex-1 overflow-y-auto px-6 py-5">
        <div className="mx-auto max-w-[760px]">
          <h1 className="text-[22px] font-semibold">{greeting(userName)}</h1>
          <p className="mb-6 text-[13px] text-muted">
            {new Date().toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>

          <BriefCard />
          {agenda && <YourDay agenda={agenda} onRefresh={() => void api.todayAgenda(true).then(setAgenda)} />}

          <section className="mb-8">
            <div className="mb-2 flex items-center gap-3">
              <h2 className="text-[14px] font-semibold">Needs your OK</h2>
              {actions.length > 1 && (
                <Button variant="primary" className="ml-auto" disabled={approving} onClick={() => setConfirm(true)}>
                  <CheckIcon size={13} /> {approving ? 'Approving…' : `Approve all ${actions.length}`}
                </Button>
              )}
            </div>
            {pending.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-line p-6 text-center text-[13px] text-muted">Nothing waiting for you.</div>
            ) : (
              <div className="space-y-4">
                {pending.map((m) => (
                  <div key={m.id} className="rounded-2xl bg-elev/60 px-4 py-3">
                    <div className="flex items-center gap-2">
                      {who(m.agentId)}
                      <span className="ml-auto text-[11px] text-muted">{listTime(m.createdAt)}</span>
                    </div>
                    {m.actions?.filter((a) => a.status === 'pending').map((a) => <ActionCard key={a.id} messageId={m.id} agentId={m.agentId} action={a} />)}
                    {m.handoffs?.filter((h) => h.status === 'pending').map((h) => <HandoffCard key={h.id} messageId={m.id} handoff={h} />)}
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="mb-8">
            <h2 className="mb-2 text-[14px] font-semibold">Coming up</h2>
            {soon.length === 0 && upcoming.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-line p-6 text-center text-[13px] text-muted">No reminders or routines in the next day.</div>
            ) : (
              <div className="divide-y divide-line overflow-hidden rounded-2xl bg-elev/60">
                {[
                  ...soon.map((r) => ({ key: r.id, at: r.at, agentId: r.agentId, text: r.text, kind: r.kind === 'task' ? 'Reminder task' : 'Reminder' })),
                  ...upcoming.map((r) => ({ key: `${r.agentId}#${r.routine.id}`, at: r.nextRun ?? 0, agentId: r.agentId, text: r.routine.prompt, kind: 'Routine' }))
                ]
                  .sort((a, b) => a.at - b.at)
                  .map((row) => (
                    <div key={row.key} className="flex items-center gap-3 px-4 py-2.5">
                      <div className="w-[130px] shrink-0 text-[12px] font-medium">{dueTime(row.at)}</div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px]">{row.text}</div>
                        <div className="text-[11px] text-muted">
                          {row.kind} · {byId[row.agentId]?.name}
                        </div>
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </section>

          <section className="mb-8">
            <h2 className="mb-2 text-[14px] font-semibold">From your routines</h2>
            {recent.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-line p-6 text-center text-[13px] text-muted">No routine has run in the last day.</div>
            ) : (
              <div className="space-y-2">
                {recent.map((r) => (
                  <div key={`${r.agentId}#${r.routine.id}`} className="rounded-2xl bg-elev/60 px-4 py-3">
                    <div className="flex items-center gap-2">
                      {who(r.agentId)}
                      <span className="ml-auto text-[11px] text-muted">{r.lastRun ? listTime(r.lastRun.at) : ''}</span>
                    </div>
                    <div className={`mt-1 text-[13px] ${r.lastRun?.ok ? '' : 'text-danger'}`}>
                      {r.lastRun?.ok ? '✓' : '✗'} {r.lastRun?.summary}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>

      {confirm && (
        <ConfirmDialog
          title={`Approve all ${actions.length} actions?`}
          body={
            <ul className="list-disc space-y-1 pl-5">
              {actions.map(({ m, a }) => (
                <li key={a.id}>
                  <strong>{byId[m.agentId]?.name}:</strong> {a.summary}
                </li>
              ))}
            </ul>
          }
          confirmLabel="Approve all"
          onCancel={() => setConfirm(false)}
          onConfirm={() => void approveAll()}
        />
      )}
    </div>
  )
}

/** Today's events and tasks, read straight from Google Calendar, Google Tasks and Apple Reminders. */
function YourDay({ agenda, onRefresh }: { agenda: Agenda; onRefresh: () => void }) {
  const { calendar, tasks, reminders } = agenda.connected
  const missing = [!calendar && 'Google Calendar', !tasks && !reminders && 'Google Tasks or Apple Reminders'].filter(Boolean)
  const now = Date.now()
  return (
    <section className="mb-8">
      <div className="mb-2 flex items-center gap-3">
        <h2 className="text-[14px] font-semibold">Your day</h2>
        {(calendar || tasks || reminders) && (
          <button type="button" onClick={onRefresh} className="ml-auto text-[12px] text-muted hover:text-fg">
            Refresh
          </button>
        )}
      </div>
      {calendar || tasks || reminders ? (
        <div className="divide-y divide-line overflow-hidden rounded-2xl bg-elev/60">
          {agenda.events.map((e, i) => (
            <div key={`e${i}`} className={`flex items-center gap-3 px-4 py-2.5 ${!e.allDay && e.end < now ? 'opacity-50' : ''}`}>
              <div className="w-[110px] shrink-0 text-[12px] font-medium">{e.allDay ? 'All day' : `${clockTime(e.start)}–${clockTime(e.end)}`}</div>
              <div className="min-w-0 flex-1 truncate text-[13px]">
                {e.title}
                {e.location && <span className="text-muted"> · {e.location}</span>}
              </div>
            </div>
          ))}
          {agenda.tasks.map((t, i) => (
            <div key={`t${i}`} className="flex items-center gap-3 px-4 py-2.5">
              <div className={`w-[110px] shrink-0 text-[12px] font-medium ${t.due !== null && t.due < now ? 'text-warn' : ''}`}>
                {t.due === null ? 'To do' : t.due < now - 86_400_000 ? 'Overdue' : t.source === 'Reminders' ? clockTime(t.due) : 'Due today'}
              </div>
              <div className="min-w-0 flex-1 truncate text-[13px]">○ {t.title}</div>
              <div className="shrink-0 text-[11px] text-muted">{t.source}</div>
            </div>
          ))}
          {agenda.events.length === 0 && agenda.tasks.length === 0 && (
            <div className="px-4 py-4 text-center text-[13px] text-muted">Nothing on your calendar or task lists today.</div>
          )}
          {agenda.errors.length > 0 && <div className="px-4 py-2 text-[12px] text-warn">{agenda.errors.join(' · ')}</div>}
        </div>
      ) : null}
      {missing.length > 0 && (
        <div className="mt-2 text-[12px] text-muted">
          Connect {missing.join(' and ')} in{' '}
          <button type="button" className="text-accent" onClick={() => useStore.getState().setView('settings')}>
            Settings → Connected tools
          </button>{' '}
          to see {calendar || tasks || reminders ? 'them' : 'your events and tasks'} here. Reading them uses no Claude usage.
        </div>
      )}
    </section>
  )
}

/** This morning's brief from the Morning Brief agent, or a button to set it up. */
function BriefCard() {
  const brief = useStore((s) => s.agents.find((a) => a.id === 'morning-brief'))
  const [text, setText] = useState<string | null>(null)

  useEffect(() => {
    if (!brief) return
    void api.listMessages(brief.id).then((list) => {
      const start = new Date()
      start.setHours(0, 0, 0, 0)
      const latest = [...list].reverse().find((m) => m.role === 'agent' && m.text && !m.streaming && m.createdAt >= start.getTime())
      setText(latest?.text ?? null)
    })
  }, [brief?.lastActivity, brief?.id])

  const setUp = async (): Promise<void> => {
    const id = await api.createMorningBrief()
    useStore.getState().select(id)
  }

  if (!brief) {
    return (
      <div className="mb-8 flex items-center gap-4 rounded-2xl border border-dashed border-line-strong p-4">
        <div className="min-w-0 flex-1 text-[13px]">
          <div className="font-medium">Get a morning brief</div>
          <div className="text-muted">
            Each morning at 7:30 a Haiku agent sums up your day (schedule, tasks, deadlines, emails that need you) in a few lines,
            shown right here. About one light run a day.
          </div>
        </div>
        <Button variant="primary" onClick={() => void setUp()}>
          Set up
        </Button>
      </div>
    )
  }
  return (
    <section className="mb-8">
      <div className="mb-2 flex items-center gap-3">
        <h2 className="text-[14px] font-semibold">Morning brief</h2>
        <button type="button" onClick={() => useStore.getState().select(brief.id)} className="ml-auto text-[12px] text-muted hover:text-fg">
          Open chat
        </button>
      </div>
      <div className="rounded-2xl bg-elev/60 px-4 py-3 text-[14px]">
        {text ? (
          <Markdown text={text} />
        ) : (
          <div className="text-[13px] text-muted">
            No brief yet today.{' '}
            <button type="button" className="text-accent" onClick={() => void api.runRoutineNow(brief.id, 'main')}>
              Write it now
            </button>
          </div>
        )}
      </div>
    </section>
  )
}
