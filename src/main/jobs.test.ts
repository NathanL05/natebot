import { describe, expect, it } from 'vitest'
import type { Job } from '@shared/types'
import { extractJobs } from './claude/stream'
import { Db } from './db'
import { deadlineReminders, jobKey, parseJob } from './jobs'

const job = (over: Partial<Job> = {}): Job => ({
  id: 'j1', company: 'Amazon', role: 'SDE Intern', status: 'saved', deadline: '2026-10-20', link: null, notes: '', agentId: 'job-hunter', createdAt: 1, updatedAt: 1, ...over
})

describe('job tracker', () => {
  it('reads a jobs block and removes it from the reply', () => {
    const r = extractJobs('2 new roles.\n\n```jobs\n[{"company":"Amazon","role":"SDE Intern"}]\n```')
    expect(r.text).toBe('2 new roles.')
    expect(r.jobs).toHaveLength(1)
  })

  it('keeps only valid fields from an agent entry', () => {
    expect(parseJob({ company: ' Amazon ', role: 'SDE  Intern', status: 'hired', deadline: 'soon', link: 'javascript:x', notes: 'From LinkedIn' })).toEqual({
      company: 'Amazon',
      role: 'SDE Intern',
      notes: 'From LinkedIn'
    })
    expect(parseJob({ company: 'Amazon' })).toBeNull()
    expect(parseJob({ company: 'A', role: 'B', status: 'interview', deadline: '2026-10-20', link: 'https://x.com' })).toMatchObject({ status: 'interview', deadline: '2026-10-20', link: 'https://x.com' })
  })

  it('reminds 2 days before and on the deadline, only for roles still to apply for', () => {
    const now = new Date(2026, 9, 3).getTime()
    expect(deadlineReminders(job(), now).map((r) => new Date(r.at).getDate())).toEqual([18, 20])
    expect(deadlineReminders(job({ status: 'applied' }), now)).toEqual([])
    expect(deadlineReminders(job(), new Date(2026, 9, 19).getTime())).toHaveLength(1)
  })

  it('stores jobs by company and role', () => {
    const db = new Db(':memory:')
    db.saveJob(job(), jobKey('Amazon', 'SDE Intern'))
    expect(db.jobByKey(jobKey(' amazon', 'sde intern '))?.id).toBe('j1')
    db.setJobReminders('j1', ['r1'])
    expect(db.jobReminders('j1')).toEqual(['r1'])
    db.deleteJob('j1')
    expect(db.listJobs()).toEqual([])
  })
})
