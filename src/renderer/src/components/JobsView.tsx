// The job tracker. Agents fill it (the Job Hunter reads Gmail on Haiku); you can change a
// status, deadline or note here. Roles still to apply for get free deadline reminders.
import { useCallback, useEffect, useState } from 'react'
import { JOB_STATUSES, type Job, type JobStatus } from '@shared/types'
import { api, useStore } from '../lib/store'
import { listTime } from '../lib/format'
import { PlusIcon, TrashIcon } from './icons'
import { Button, IconButton, inputBase } from './ui'

const ORDER: JobStatus[] = ['interview', 'offer', 'saved', 'applied', 'rejected']

function daysLeft(deadline: string): string {
  const [y, m, d] = deadline.split('-').map(Number)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const days = Math.round((new Date(y ?? 0, (m ?? 1) - 1, d ?? 1).getTime() - today.getTime()) / 86_400_000)
  if (days < 0) return 'deadline passed'
  if (days === 0) return 'due today'
  if (days === 1) return 'due tomorrow'
  return `due in ${days} days`
}

export function JobsView() {
  const agents = useStore((s) => s.agents)
  const [jobs, setJobs] = useState<Job[] | null>(null)
  const hasHunter = agents.some((a) => a.id === 'job-hunter')

  const load = useCallback(() => void api.listJobs().then(setJobs), [])
  useEffect(load, [agents, load])

  const save = (job: Job, patch: Partial<Job>): void => void api.updateJob({ ...job, ...patch }).then(load)

  const createHunter = async (): Promise<void> => {
    const id = await api.createJobHunter()
    useStore.getState().select(id)
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="drag flex h-[52px] shrink-0 items-center border-b border-line px-6">
        <div className="text-[15px] font-semibold">Jobs</div>
      </header>
      <div className="flex-1 overflow-y-auto px-6 py-5">
        <div className="mx-auto max-w-[820px]">
          <p className="mb-4 text-[13px] text-muted">
            Roles and applications your agents found in your email. Roles marked “To apply” with a deadline get reminders 2 days before
            and on the day (these cost nothing).
          </p>
          {!hasHunter && (
            <div className="mb-5 flex items-center gap-4 rounded-2xl border border-dashed border-line-strong p-4">
              <div className="min-w-0 flex-1 text-[13px]">
                <div className="font-medium">Let the Job Hunter fill this in</div>
                <div className="text-muted">
                  A Haiku agent that checks Gmail for application updates and roles worth applying to each weekday at 8:30, and straight away
                  when an interview or assessment email arrives. Light on your limit.
                </div>
              </div>
              <Button variant="primary" onClick={() => void createHunter()}>
                <PlusIcon size={13} /> Create Job Hunter
              </Button>
            </div>
          )}
          {jobs?.length === 0 && (
            <div className="rounded-2xl border border-dashed border-line p-8 text-center text-[13px] text-muted">
              No jobs yet. {hasHunter ? 'The Job Hunter adds them as it finds them, or ask it to check now.' : ''}
            </div>
          )}
          {ORDER.map((status) => {
            const list = (jobs ?? []).filter((j) => j.status === status)
            if (!list.length) return null
            return (
              <section key={status} className="mb-6">
                <h2 className="mb-2 text-[12px] font-medium tracking-wide text-muted uppercase">
                  {JOB_STATUSES.find((s) => s.id === status)?.label} · {list.length}
                </h2>
                <div className="divide-y divide-line overflow-hidden rounded-2xl bg-elev/60">
                  {list.map((j) => (
                    <div key={j.id} className="flex items-center gap-3 px-4 py-2.5">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] font-medium">
                          {j.link ? (
                            <a href={j.link} onClick={(e) => (e.preventDefault(), void api.openExternal(j.link ?? ''))} className="hover:underline">
                              {j.role}
                            </a>
                          ) : (
                            j.role
                          )}{' '}
                          <span className="text-muted">· {j.company}</span>
                        </div>
                        <div className="truncate text-[12px] text-muted">
                          {[j.deadline && `${j.deadline} (${daysLeft(j.deadline)})`, j.notes, `updated ${listTime(j.updatedAt)}`].filter(Boolean).join(' · ')}
                        </div>
                      </div>
                      <input
                        type="date"
                        aria-label="Deadline"
                        className={`${inputBase} h-8 w-[140px] py-0 text-[12px]`}
                        value={j.deadline ?? ''}
                        onChange={(e) => save(j, { deadline: e.target.value || null })}
                      />
                      <select
                        aria-label="Status"
                        className={`${inputBase} h-8 w-[130px] py-0 text-[12px]`}
                        value={j.status}
                        onChange={(e) => save(j, { status: e.target.value as JobStatus })}
                      >
                        {JOB_STATUSES.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.label}
                          </option>
                        ))}
                      </select>
                      <IconButton label={`Remove ${j.role}`} onClick={() => void api.deleteJob(j.id).then(load)}>
                        <TrashIcon size={14} />
                      </IconButton>
                    </div>
                  ))}
                </div>
              </section>
            )
          })}
        </div>
      </div>
    </div>
  )
}
