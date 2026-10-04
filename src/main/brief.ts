// The Morning Brief agent, and {{today}} in routine prompts: NateBot fills it with
// today's calendar, tasks, reminders, job deadlines and waiting approvals from what it
// already knows, so the agent doesn't spend tool calls (and usage) fetching them.
import type { Agenda, AgentDraft, Job, Reminder } from '@shared/types'

export const TODAY_TOKEN = '{{today}}'
export const BRIEF_ID = 'morning-brief'

const time = (ts: number): string => new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })

/** A compact text block describing the user's day, for {{today}}. */
export function todayContext(input: { agenda: Agenda; reminders: Reminder[]; jobs: Job[]; pending: number; now: number }): string {
  const { agenda, reminders, jobs, pending, now } = input
  const end = new Date(now)
  end.setHours(23, 59, 59, 999)
  const week = now + 7 * 86_400_000
  const lines: string[] = ['[Today, from NateBot]']
  if (agenda.connected.calendar) {
    lines.push(agenda.events.length ? 'Calendar:' : 'Calendar: nothing scheduled.')
    for (const e of agenda.events) lines.push(`- ${e.allDay ? 'All day' : `${time(e.start)}–${time(e.end)}`} ${e.title}${e.location ? ` (${e.location})` : ''}`)
  } else lines.push('Calendar: not connected.')
  const tasks = agenda.tasks.map((t) => `- ${t.title}${t.due ? ` (due ${t.due < now ? 'already' : time(t.due)})` : ''} [${t.source}]`)
  if (tasks.length) lines.push('Tasks:', ...tasks)
  const due = reminders.filter((r) => r.at <= end.getTime())
  if (due.length) lines.push('Reminders set in NateBot for today:', ...due.map((r) => `- ${time(r.at)} ${r.text}`))
  const deadlines = jobs.filter((j) => j.status === 'saved' && j.deadline && new Date(`${j.deadline}T23:59`).getTime() <= week)
  if (deadlines.length) lines.push('Job application deadlines this week:', ...deadlines.map((j) => `- ${j.deadline} ${j.role} at ${j.company}`))
  const interviews = jobs.filter((j) => j.status === 'interview')
  if (interviews.length) lines.push('Interviewing with:', ...interviews.map((j) => `- ${j.company} (${j.role})`))
  if (pending) lines.push(`Waiting for the user's approval in NateBot: ${pending}`)
  return lines.join('\n')
}

/** The Morning Brief agent, given the tools that are connected. */
export function briefDraft(servers: string[]): AgentDraft {
  return {
    name: 'Morning Brief',
    shape: 'circle',
    color: '#FBBF24',
    model: 'haiku',
    effort: 'low',
    instructions: [
      'Every morning you write my brief: at most 12 short lines, warm but to the point.',
      '1. The day at a glance, including the weather if you know my city (one web search at most).',
      '2. My schedule, tasks, reminders and deadlines from the [Today, from NateBot] block. Use it as given and do not fetch them again.',
      servers.includes('gmail') ? '3. Emails that need me: one Gmail search for unread mail from the last day, skipping promotions and newsletters.' : '',
      "4. One concrete suggestion for the day (what to tackle first, or a gap to use). If you can read my plan folders, base it on today's step there (read at most two files).",
      'Use ✓ checklists. Never send anything or change anything yourself.'
    ]
      .filter(Boolean)
      .join('\n'),
    mcp_servers: servers,
    allowed_tools: ['WebSearch'],
    disallowed_tools: [],
    quick_prompts: ['Write my morning brief'],
    routines: [{ id: 'main', enabled: true, cron: '30 7 * * *', prompt: `Write my morning brief.\n\n${TODAY_TOKEN}` }],
    email_triggers: [],
    read_folders: []
  }
}
