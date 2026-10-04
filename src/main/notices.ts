// What macOS notifications say. Approval notifications get Approve / Reject
// buttons only for a single action whose details are all either shown or
// plainly message text, and they name the tool, so a one-tap Approve never
// rests on the agent's own summary alone.
import type { ProposedAction } from '@shared/types'
import { describeTool } from '@shared/tools'

/** Button order on approval notifications (the index Electron reports). */
export const APPROVE = 0
export const REJECT = 1
export const APPROVAL_BUTTONS = ['Approve', 'Reject']

/** Detail keys shown in a notification, in order. */
const SHOWN: [string, string][] = [
  ['action', 'Action'],
  ['summary', 'Event'],
  ['start_time', 'Starts'],
  ['end_time', 'Ends'],
  ['attendees', 'Guests'],
  ['location', 'Where'],
  ['to', 'To'],
  ['cc', 'Cc'],
  ['bcc', 'Bcc'],
  ['subject', 'Subject'],
  ['title', 'Title'],
  ['when', 'When'],
  ['date', 'Date'],
  ['due', 'Due'],
  ['task_list_id', 'List'],
  ['name', 'Name']
]

/** Message text: fine to leave out of a notification (it's in the app). */
const TEXT_KEYS = new Set(['body', 'message', 'content', 'text', 'html', 'description', 'notes'])

const short = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

/** Any detail value as plain text: lists joined, objects (e.g. {email, name}) flattened. */
function textOf(v: unknown): string {
  if (typeof v === 'string') return v.trim()
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (Array.isArray(v)) return v.map(textOf).filter(Boolean).join(', ')
  if (v && typeof v === 'object') return Object.values(v).map(textOf).filter(Boolean).join(' ')
  return ''
}

/** The body of a "Needs your approval" notification, and the action its buttons would resolve (if any). */
export function approvalNotice(actions: ProposedAction[] | undefined): { body: string; action: ProposedAction | null } | null {
  const pending = (actions ?? []).filter((a) => a.status === 'pending')
  const first = pending[0]
  if (!first) return null
  if (pending.length > 1) {
    return { body: `${pending.length} actions to approve, starting with: ${short(first.summary, 80)}`, action: null }
  }
  const lines = [first.summary]
  if (first.tool) {
    const { source, action } = describeTool(first.tool)
    lines.push(`Via ${source}${action ? ` · ${action}` : ''}`)
  }
  for (const [key, label] of SHOWN) {
    const text = textOf(first.details[key])
    if (text) lines.push(`${label}: ${short(text, 60)}`)
  }
  // Anything that would be carried out without being shown here needs the full card.
  const shown = new Set(SHOWN.map(([key]) => key))
  const hidden = Object.keys(first.details).filter((k) => !shown.has(k) && !TEXT_KEYS.has(k.toLowerCase()))
  return { body: lines.join('\n'), action: hidden.length ? null : first }
}
