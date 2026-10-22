import { describe, expect, it } from 'vitest'
import { Db } from './db'
import { bodyText, findRoles, parseCompanies, radarKey, radarQuery, skipRoles, toHits } from './radar'

const companies = parseCompanies(['HSBC', 'Citi', 'JPMorgan / J.P. Morgan / JPMorgan Chase', 'Standard Chartered'])

const LINKEDIN_ALERT = `Your job alert for platform engineer in Dublin
12 new jobs match your preferences.

Graduate Platform Engineer
Citi
Dublin, County Dublin, Ireland

View job: https://www.linkedin.com/comm/jobs/view/4012345678/?trackingId=abc

---------------------------------------------------------

Cloud Engineer
Citizens Advice
Dublin, Ireland

View job: https://www.linkedin.com/comm/jobs/view/4099999999/

---------------------------------------------------------

Software Engineer Programme 2027
J.P. Morgan
Glasgow, Scotland, United Kingdom

View job: https://www.linkedin.com/comm/jobs/view/4087654321/

See all jobs: https://www.linkedin.com/comm/jobs/search/?keywords=platform
`

describe('job radar', () => {
  it('reads companies and the names they go by', () => {
    expect(companies[2]).toEqual({ name: 'JPMorgan', names: ['JPMorgan', 'J.P. Morgan', 'JPMorgan Chase'] })
    expect(parseCompanies(['', ' / ', 'A'])).toEqual([])
  })

  it('searches recent job alerts that name a company', () => {
    const q = radarQuery(companies)
    expect(q).toContain('newer_than:3d')
    expect(q).toContain('from:(linkedin.com OR')
    expect(q).toContain('"J.P. Morgan"')
    expect(radarKey(companies)).not.toBe(radarKey(parseCompanies(['HSBC'])))
    expect(radarKey(companies, ['Senior'])).not.toBe(radarKey(companies))
  })

  it('takes each role from a LinkedIn alert, with its place and link', () => {
    const roles = findRoles(LINKEDIN_ALERT, 'Platform engineer: Citi and more', 'LinkedIn Job Alerts', companies)
    expect(roles).toEqual([
      { company: 'Citi', title: 'Graduate Platform Engineer', location: 'Dublin, County Dublin, Ireland', link: 'https://www.linkedin.com/comm/jobs/view/4012345678/?trackingId=abc' },
      { company: 'JPMorgan', title: 'Software Engineer Programme 2027', location: 'Glasgow, Scotland, United Kingdom', link: 'https://www.linkedin.com/comm/jobs/view/4087654321/' }
    ])
  })

  it('reads "Role at Company" lines, ignores names inside links, and falls back to the subject', () => {
    expect(findRoles('New: Technology Graduate Programme at HSBC (Hong Kong)\nhttps://hsbc.taleo.net/x', 'New jobs', 'HSBC Careers', companies)).toEqual([
      { company: 'HSBC', title: 'New: Technology Graduate Programme at HSBC (Hong Kong)', location: null, link: 'https://hsbc.taleo.net/x' }
    ])
    expect(findRoles('Apply at https://citi.wd5.myworkdayjobs.com/en-US/2', 'Your weekly digest', 'Workday', companies)).toEqual([])
    expect(findRoles('We found 3 new roles for you.', 'Standard Chartered is hiring', 'Careers', companies)).toEqual([
      { company: 'Standard Chartered', title: 'Standard Chartered is hiring', location: null, link: null }
    ])
  })

  it('reads the plain-text part, or the HTML one as text', () => {
    const b64 = (s: string): string => Buffer.from(s).toString('base64url')
    expect(bodyText({ mimeType: 'multipart/alternative', parts: [{ mimeType: 'text/html', body: { data: b64('<p>x</p>') } }, { mimeType: 'text/plain', body: { data: b64('Role\r\nHSBC') } }] })).toBe('Role\nHSBC')
    expect(bodyText({ mimeType: 'text/html', body: { data: b64('<div>Cloud Engineer</div><div>HSBC</div><style>p{}</style>') } })).toBe('Cloud Engineer\nHSBC')
    expect(bodyText(undefined)).toBe('')
  })

  it('leaves out titles with a skipped word', () => {
    const roles = ['Senior Full-Stack Developer', 'Java Software Engineer (AVP)', 'Graduate Engineer', 'Seniority Analyst'].map((title) => ({ company: 'Citi', title, location: null, link: null }))
    expect(skipRoles(roles, ['senior', 'AVP', ' ']).map((r) => r.title)).toEqual(['Graduate Engineer', 'Seniority Analyst'])
    expect(skipRoles(roles, [])).toHaveLength(4)
  })

  it('stores each role once, even when later alerts repeat it, and lists new ones first', () => {
    const db = new Db(':memory:')
    const now = Date.now()
    const a = toHits('t1', 'LinkedIn', now - 1000, [{ company: 'Citi', title: 'Engineer', location: null, link: null }])
    const b = toHits('t2', 'LinkedIn', now, [{ company: 'HSBC', title: 'Engineer', location: 'Hong Kong', link: null }])
    expect(db.addRadarHits([...a, ...b])).toHaveLength(2)
    expect(db.addRadarHits(toHits('t3', 'LinkedIn', now, [{ company: 'Citi', title: 'engineer', location: null, link: 'https://x' }]))).toEqual([])
    db.setRadarStatus(b[0]!.id, 'dismissed')
    expect(db.listRadarHits(now - 86_400_000).map((h) => [h.company, h.status])).toEqual([
      ['Citi', 'new'],
      ['HSBC', 'dismissed']
    ])
    expect(db.listRadarHits(now + 1)).toEqual([])
  })
})
