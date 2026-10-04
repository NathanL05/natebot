// The job tracker: roles and applications that agents add with a ```jobs block (or
// you edit by hand). Deadlines get free message reminders. The Job Hunter agent fills
// it from Gmail on Haiku, once a day and when an interview or assessment email arrives.
import type { AgentDraft, Job, JobStatus } from '@shared/types'
import { JOB_STATUSES } from '@shared/types'

const STATUS_IDS = JOB_STATUSES.map((s) => s.id)
const DAY = 86_400_000

export const jobKey = (company: string, role: string): string => `${company.trim().toLowerCase()}|${role.trim().toLowerCase()}`

const text = (v: unknown, n: number): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) : '')

/** An entry from an agent's block, or null if it has no company and role. Missing fields stay unset. */
export function parseJob(raw: Record<string, unknown>): Partial<Job> & { company: string; role: string } | null {
  const company = text(raw['company'], 80)
  const role = text(raw['role'], 120)
  if (!company || !role) return null
  const out: Partial<Job> & { company: string; role: string } = { company, role }
  if (STATUS_IDS.includes(raw['status'] as JobStatus)) out.status = raw['status'] as JobStatus
  if (typeof raw['deadline'] === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw['deadline'])) out.deadline = raw['deadline']
  const link = text(raw['link'], 500)
  if (/^https?:\/\//i.test(link)) out.link = link
  const notes = text(raw['notes'], 300)
  if (notes) out.notes = notes
  return out
}

/** Reminder times for a job still to apply for: 2 days before its deadline and on the day, at 9:00, if still ahead. */
export function deadlineReminders(job: Job, now: number): { at: number; text: string }[] {
  if (job.status !== 'saved' || !job.deadline) return []
  const [y, m, d] = job.deadline.split('-').map(Number)
  const day = new Date(y ?? 0, (m ?? 1) - 1, d ?? 1, 9, 0).getTime()
  const what = `${job.role} at ${job.company}`
  return [
    { at: day - 2 * DAY, text: `Application deadline in 2 days: ${what}` },
    { at: day, text: `Application deadline today: ${what}` }
  ].filter((r) => r.at > now)
}

export const JOB_HUNTER_ID = 'job-hunter'

export const JOB_HUNTER: AgentDraft = {
  name: 'Job Hunter',
  shape: 'triangle',
  color: '#FF7A45',
  model: 'haiku',
  effort: 'low',
  instructions: [
    'You keep my job and internship tracker up to date from my Gmail. Look at job-related email since your last check:',
    'application confirmations, online assessments, interview invites, rejections, offers, and job alerts for roles that fit me.',
    'For each role that is new or whose status changed, end your reply with one fenced block like this:',
    '```jobs',
    '[{"company": "Amazon", "role": "SDE Intern 2027", "status": "saved", "deadline": "2026-10-20", "link": "https://...", "notes": "LinkedIn alert"}]',
    '```',
    'status is saved (worth applying to), applied, interview, offer or rejected. deadline is YYYY-MM-DD, or leave it out.',
    "Skip marketing, newsletters and roles that clearly don't fit. Before the block, give me 2-4 short lines: what changed and what I should do next.",
    'If you can read my career-plan folders, check roles against them (target companies, the role I am aiming for) and say why a role fits or not.',
    'Never send an email yourself: draft replies and propose them for approval.'
  ].join('\n'),
  mcp_servers: ['gmail'],
  allowed_tools: [],
  disallowed_tools: [],
  quick_prompts: ['What should I apply to this week?', 'Any application updates?'],
  routines: [
    { id: 'main', enabled: true, cron: '30 8 * * 1-5', prompt: 'Check my email for job application updates and new roles worth applying to since your last check.' }
  ],
  read_folders: [],
  email_triggers: [
    {
      id: 'interviews',
      enabled: true,
      query: 'subject:(interview OR assessment OR "coding challenge" OR "next steps" OR "online test")',
      prompt: 'Update my job tracker from this email and tell me what I need to do and by when.'
    }
  ]
}
