import { describe, expect, it } from 'vitest'
import type { Agenda } from '@shared/types'
import { briefDraft, todayContext } from './brief'

const now = new Date(2026, 9, 5, 7, 30).getTime()
const agenda: Agenda = {
  events: [{ title: 'Lecture', start: new Date(2026, 9, 5, 10).getTime(), end: new Date(2026, 9, 5, 11).getTime(), allDay: false, location: 'Room 2' }],
  tasks: [{ title: 'Lab report', due: new Date(2026, 9, 5, 9).getTime(), source: 'Google Tasks' }],
  connected: { calendar: true, tasks: true, reminders: false },
  errors: []
}

describe('morning brief', () => {
  it('describes the day from what NateBot knows', () => {
    const text = todayContext({
      agenda,
      reminders: [{ id: 'r', agentId: 'a', messageId: '', at: new Date(2026, 9, 5, 19).getTime(), kind: 'message', text: 'Gym', status: 'scheduled' }],
      jobs: [
        { id: 'j', company: 'Amazon', role: 'SDE Intern', status: 'saved', deadline: '2026-10-08', link: null, notes: '', agentId: 'a', createdAt: 0, updatedAt: 0 },
        { id: 'k', company: 'Stripe', role: 'Intern', status: 'interview', deadline: null, link: null, notes: '', agentId: 'a', createdAt: 0, updatedAt: 0 }
      ],
      pending: 2,
      now
    })
    expect(text).toContain('- 10:00–11:00 Lecture (Room 2)')
    expect(text).toContain('- Lab report (due 09:00) [Google Tasks]')
    expect(text).toContain('- 19:00 Gym')
    expect(text).toContain('- 2026-10-08 SDE Intern at Amazon')
    expect(text).toContain('- Stripe (Intern)')
    expect(text).toContain('approval in NateBot: 2')
  })

  it('only mentions Gmail when it is connected', () => {
    expect(briefDraft([]).instructions).not.toContain('Gmail')
    expect(briefDraft(['gmail']).mcp_servers).toEqual(['gmail'])
    expect(briefDraft([]).routines[0]?.prompt).toContain('{{today}}')
  })
})
