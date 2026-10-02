// What macOS notifications say. Approval notifications get Approve / Reject
// buttons only when there's exactly one action, and show its key details,
// so you know exactly what you're approving without opening the app.
import type { ProposedAction } from '@shared/types'

/** Button order on approval notifications (the index Electron reports). */
export const APPROVE = 0
export const REJECT = 1
export const APPROVAL_BUTTONS = ['Approve', 'Reject']

/** Detail keys worth showing in a notification, in order. */
const KEY_DETAILS: [string, string][] = [
  ['to', 'To'],
  ['subject', 'Subject'],
  ['title', 'Title'],
  ['when', 'When'],
  ['date', 'Date']
]

const short = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

function keyDetails(details: Record<string, unknown>): string {
  return KEY_DETAILS.flatMap(([key, label]) => {
    const v = details[key]
    const text = Array.isArray(v) ? v.filter((x) => typeof x === 'string').join(', ') : typeof v === 'string' ? v : ''
    return text.trim() ? [`${label}: ${short(text.trim(), 60)}`] : []
  }).join('\n')
}

/** The body of a "Needs your approval" notification, and whether it may offer buttons. */
export function approvalNotice(actions: ProposedAction[] | undefined): { body: string; action: ProposedAction | null } | null {
  const pending = (actions ?? []).filter((a) => a.status === 'pending')
  const first = pending[0]
  if (!first) return null
  if (pending.length > 1) {
    return { body: `${pending.length} actions to approve, starting with: ${short(first.summary, 80)}`, action: null }
  }
  const details = keyDetails(first.details)
  return { body: details ? `${first.summary}\n${details}` : first.summary, action: first }
}
