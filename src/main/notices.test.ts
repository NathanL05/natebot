// Approval notifications: buttons only for a single action, and enough detail
// to know what Approve will do.
import { describe, expect, it } from 'vitest'
import type { ProposedAction } from '@shared/types'
import { approvalNotice, autoApprovable } from './notices'

const action = (over: Partial<ProposedAction> = {}): ProposedAction => ({
  id: 'a1',
  type: 'send_email',
  summary: 'Reply to Sarah re: deadline',
  tool: 'mcp__gmail__send_gmail_message',
  details: { to: 'sarah@example.com', subject: 'Re: Deadline', body: 'Hi Sarah, …' },
  status: 'pending',
  ...over
})

describe('approvalNotice', () => {
  it('offers buttons for a single pending action and shows who and what', () => {
    const n = approvalNotice([action()])
    expect(n?.action?.id).toBe('a1')
    expect(n?.body).toBe('Reply to Sarah re: deadline\nVia Gmail · send_gmail_message\nTo: sarah@example.com\nSubject: Re: Deadline')
  })

  it('never puts the message body in the notification', () => {
    expect(approvalNotice([action()])?.body).not.toContain('Hi Sarah')
  })

  it('sends you to the app when there are several actions', () => {
    const n = approvalNotice([action(), action({ id: 'a2', summary: 'Archive newsletter' })])
    expect(n?.action).toBeNull()
    expect(n?.body).toBe('2 actions to approve, starting with: Reply to Sarah re: deadline')
  })

  it('ignores actions that are already resolved', () => {
    expect(approvalNotice([action({ status: 'done' })])).toBeNull()
    expect(approvalNotice(undefined)).toBeNull()
    expect(approvalNotice([action({ status: 'rejected' }), action({ id: 'a2' })])?.action?.id).toBe('a2')
  })

  it('sends you to the app when a detail would be carried out unseen', () => {
    // A recipient under a key the notification doesn't show: no one-tap Approve.
    const n = approvalNotice([action({ summary: 'Archive the newsletter', details: { recipient: 'x@evil.com', body: '…' } })])
    expect(n?.action).toBeNull()
    expect(n?.body).toContain('Via Gmail · send_gmail_message')
  })

  it('shows recipients given as objects', () => {
    const body = approvalNotice([action({ details: { to: [{ email: 'boss@x.com', name: 'Boss' }], subject: 'Hi' } })])?.body
    expect(body).toContain('To: boss@x.com Boss')
  })

  it('offers buttons for a calendar event whose details are all shown', () => {
    const n = approvalNotice([
      action({
        type: 'create_event',
        summary: 'Add focus block Friday 2–4 PM',
        tool: 'mcp__gcal__manage_event',
        details: { action: 'create', summary: 'Focus: Sarah deadline', start_time: '2026-10-09T14:00', end_time: '2026-10-09T16:00', description: 'Prep' }
      })
    ])
    expect(n?.action?.id).toBe('a1')
    expect(n?.body).toContain('Event: Focus: Sarah deadline')
    expect(n?.body).toContain('Starts: 2026-10-09T14:00')
    expect(n?.body).toContain('Via Calendar · manage_event')
  })

  it('joins list recipients and shortens long values', () => {
    const body = approvalNotice([action({ details: { to: ['a@x.com', 'b@x.com'], subject: 'x'.repeat(100) } })])?.body ?? ''
    expect(body).toContain('To: a@x.com, b@x.com')
    expect(body).toMatch(/Subject: x{59}…$/)
  })
})

describe('Always allow', () => {
  const act = (id: string, tool: string | undefined, status: ProposedAction['status'] = 'pending'): ProposedAction => ({ id, type: 't', summary: id, tool, details: {}, status })

  it('covers only pending actions whose tool has a rule', () => {
    const actions = [act('a', 'mcp__gtasks__create_task'), act('b', 'mcp__gmail__send_gmail_message'), act('c', 'mcp__gtasks__create_task', 'done'), act('d', undefined)]
    expect(autoApprovable(actions, ['mcp__gtasks__create_task'])).toEqual(['a'])
    expect(autoApprovable(actions, [])).toEqual([])
  })

  it("leaves auto-approved actions out of the approval notification", () => {
    const auto = { ...act('a', 'mcp__gtasks__create_task'), auto: true }
    expect(approvalNotice([auto])).toBeNull()
    expect(approvalNotice([auto, act('b', 'mcp__gmail__send_gmail_message')])?.body).toMatch(/^b/)
  })
})
