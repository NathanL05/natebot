// Job radar: NateBot reads job-alert email itself (LinkedIn, company careers sites) with the
// Gmail API and keeps only roles at the companies listed in Settings, so a role at a company
// you care about is never buried in an alert. No Claude run, so it costs no usage.
// The first check after turning it on (or changing the list) fills Today without notifying.
import type { RadarHit } from '@shared/types'
import { TRIGGER_START, type Db } from './db'
import { GoogleToken } from './google-api'
import { pageText } from './webwatch'

const CHECK_EVERY_MS = 15 * 60_000
const FIRST_CHECK_MS = 45_000
const API = 'https://gmail.googleapis.com/gmail/v1/users/me'
const MAX_MAILS = 25
const MAX_PER_MAIL = 6
const MAX_TITLE = 140

/** Where job alerts come from: job sites, the usual careers-site systems, and alert-like subjects. */
const ALERT_SENDERS = [
  'linkedin.com',
  'myworkday.com',
  'myworkdayjobs.com',
  'oraclecloud.com',
  'taleo.net',
  'successfactors.com',
  'successfactors.eu',
  'eightfold.ai',
  'avature.net',
  'phenompeople.com',
  'greenhouse.io',
  'lever.co',
  'smartrecruiters.com',
  'icims.com',
  'indeed.com',
  'glassdoor.com',
  'careers',
  'jobs',
  'recruiting',
  'talent'
]
const ALERT_SUBJECTS = ['"job alert"', '"jobs alert"', '"new jobs"', '"jobs for you"', '"job matches"', '"new opportunities"', '"is hiring"', '"new job"']

export interface RadarCompany {
  /** The name shown (the first one on the line). */
  name: string
  /** Every name it goes by, the first included. */
  names: string[]
}

/** Settings lines ("JPMorgan / J.P. Morgan / JPMorgan Chase") → companies. */
export function parseCompanies(lines: string[]): RadarCompany[] {
  return lines
    .map((line) => line.split('/').map((n) => n.replace(/["()]/g, ' ').replace(/\s+/g, ' ').trim()).filter((n) => n.length >= 2))
    .filter((names) => names.length > 0)
    .map((names) => ({ name: names[0] as string, names }))
}

/** The Gmail search: recent job alerts that mention one of the companies. */
export function radarQuery(companies: RadarCompany[]): string {
  const names = companies.flatMap((c) => c.names).map((n) => `"${n}"`)
  return `newer_than:3d -from:me (from:(${ALERT_SENDERS.join(' OR ')}) OR subject:(${ALERT_SUBJECTS.join(' OR ')})) (${names.join(' OR ')})`
}

/** Changes with the company list and skip words, so editing either rereads recent alerts (quietly). */
export function radarKey(companies: RadarCompany[], skip: string[] = []): string {
  let h = 0
  for (const ch of JSON.stringify([companies, skip])) h = (h * 31 + ch.charCodeAt(0)) | 0
  return `radar#${(h >>> 0).toString(36)}`
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Matches any of these as whole words ("Citi" but not "Citizens"), ignoring case. */
function wordsRe(words: string[]): RegExp {
  return new RegExp(`(^|[^\\p{L}\\p{N}])(${words.map(escapeRe).join('|')})(?![\\p{L}\\p{N}])`, 'iu')
}

const URL_RE = /https?:\/\/[^\s<>"')\]]+/i
const withoutUrls = (line: string): string => line.replace(/https?:\/\/\S+/gi, ' ')
const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s)
/** Lines that are links, buttons or boilerplate, never a role or a place. */
const NOISE = /^(view job|apply( now)?|see (all )?jobs?|see more|unsubscribe|manage|learn more|https?:)|^[-–—=_*·•|\s]+$/i

export interface FoundRole {
  company: string
  title: string
  location: string | null
  link: string | null
}

/**
 * Roles at the companies in an alert's text. Alerts list each job as a few short lines
 * (title, company, place, link), so a short line naming the company takes its title from
 * the line before and its place from the line after; a longer line ("Software Engineer at
 * Citi") is its own title. The subject stands in when the body names the company only in passing.
 */
export function findRoles(text: string, subject: string, from: string, companies: RadarCompany[]): FoundRole[] {
  const lines = text.split('\n').map((l) => l.replace(/\s+/g, ' ').trim())
  const out: FoundRole[] = []
  const seen = new Set<string>()
  const add = (r: FoundRole): void => {
    const key = `${r.company}|${r.title.toLowerCase()}`
    if (seen.has(key) || out.length >= MAX_PER_MAIL) return
    seen.add(key)
    out.push(r)
  }
  const near = (i: number, step: number): string | null => {
    for (let j = i + step, n = 0; j >= 0 && j < lines.length && n < 3; j += step) {
      const l = lines[j] ?? ''
      if (!l) continue
      n++
      if (NOISE.test(l) || URL_RE.test(l)) continue
      return l
    }
    return null
  }
  const linkAfter = (i: number): string | null => {
    for (let j = Math.max(0, i - 2); j < Math.min(lines.length, i + 7); j++) {
      const m = URL_RE.exec(lines[j] ?? '')
      if (m) return m[0].replace(/[.,;]+$/, '')
    }
    return null
  }
  for (const c of companies) {
    const re = wordsRe(c.names)
    lines.forEach((line, i) => {
      const plain = withoutUrls(line).trim()
      if (!plain || plain.length > 300 || !re.test(plain)) return
      const short = plain.length <= Math.max(...c.names.map((n) => n.length)) + 40
      if (short) {
        const before = near(i, -1)
        const after = near(i, 1)
        const title = before && before.length <= MAX_TITLE && !re.test(before) ? before : null
        if (!title) return
        const location = after && after.length <= 80 && !re.test(after) ? after : null
        add({ company: c.name, title: clip(title, MAX_TITLE), location, link: linkAfter(i) })
      } else if (plain.length <= MAX_TITLE) {
        add({ company: c.name, title: plain, location: null, link: linkAfter(i) })
      }
    })
    if (!out.some((r) => r.company === c.name) && (re.test(subject) || re.test(from))) {
      add({ company: c.name, title: clip(subject.trim() || '(no subject)', MAX_TITLE), location: null, link: null })
    }
  }
  return out
}

interface GmailPart {
  mimeType?: string
  body?: { data?: string }
  parts?: GmailPart[]
}

/** An email's text: its plain-text part, or its HTML part turned into text. */
export function bodyText(payload: GmailPart | undefined): string {
  const find = (p: GmailPart | undefined, type: string): string | null => {
    if (!p) return null
    if (p.mimeType === type && p.body?.data) return Buffer.from(p.body.data, 'base64url').toString('utf8')
    for (const child of p.parts ?? []) {
      const hit = find(child, type)
      if (hit) return hit
    }
    return null
  }
  const plain = find(payload, 'text/plain')
  if (plain) return plain.replace(/\r\n?/g, '\n')
  const html = find(payload, 'text/html')
  return html ? pageText(html) : ''
}

/** A short stable hash for hit ids. */
function hash(s: string): string {
  let a = 0
  let b = 7
  for (const ch of s) {
    a = (a * 31 + ch.charCodeAt(0)) | 0
    b = (b * 131 + ch.charCodeAt(0)) | 0
  }
  return `${(a >>> 0).toString(36)}${(b >>> 0).toString(36)}`
}

/** Roles whose title has one of these words ("Senior", "VP"), as whole words. */
export function skipRoles<T extends { title: string }>(roles: T[], words: string[]): T[] {
  const list = words.map((w) => w.trim()).filter(Boolean)
  if (!list.length) return roles
  const re = wordsRe(list)
  return roles.filter((r) => !re.test(r.title))
}

/** One find per company and title: alerts repeat the same role for days, so later ones are the same find. */
export function toHits(threadId: string, from: string, receivedAt: number, roles: FoundRole[]): RadarHit[] {
  return roles.map((r) => ({
    id: hash(`${r.company.toLowerCase()}|${r.title.toLowerCase()}`),
    company: r.company,
    title: r.title,
    location: r.location,
    link: r.link,
    threadId,
    from,
    receivedAt,
    status: 'new'
  }))
}

interface GmailMessage {
  id: string
  threadId: string
  internalDate?: string
  payload?: GmailPart & { headers?: { name: string; value: string }[] }
}

export class RadarWatcher {
  private timer: NodeJS.Timeout | undefined
  private first: NodeJS.Timeout | undefined
  private google: GoogleToken
  private checking: Promise<void> | null = null
  checkedAt: number | null = null
  error: string | null = null

  constructor(
    private deps: {
      db: Db
      /** The companies to look for, or [] when the radar is off. */
      companies: () => string[]
      /** Words that rule a title out ("Senior"). */
      skip: () => string[]
      tokenPath: () => string | null
      /** New roles after the first check (the first only fills Today). */
      onFound: (hits: RadarHit[]) => void
      onSignInExpired: (path: string) => void
      log: (line: string) => void
    }
  ) {
    this.google = new GoogleToken(deps.tokenPath, deps.onSignInExpired)
  }

  start(): void {
    this.first = setTimeout(() => void this.check(), FIRST_CHECK_MS)
    this.timer = setInterval(() => void this.check(), CHECK_EVERY_MS)
  }

  stop(): void {
    clearTimeout(this.first)
    clearInterval(this.timer)
  }

  active(): boolean {
    return this.deps.companies().length > 0 && this.google.available()
  }

  /** Checks now (or waits for the check already running). */
  check(): Promise<void> {
    this.checking ??= this.run().finally(() => (this.checking = null))
    return this.checking
  }

  private async run(): Promise<void> {
    const companies = parseCompanies(this.deps.companies())
    if (companies.length === 0 || !this.google.available()) return
    try {
      const skip = this.deps.skip()
      const key = radarKey(companies, skip)
      const started = this.deps.db.triggerStarted(key)
      const q = encodeURIComponent(radarQuery(companies))
      const list = await this.google.fetchJson<{ messages?: { id: string }[] }>(`${API}/messages?q=${q}&maxResults=${MAX_MAILS}`)
      const ids = (list.messages ?? []).map((m) => m.id)
      const unseen = this.deps.db.unseenEmails(key, [TRIGGER_START, ...ids]).filter((id) => id !== TRIGGER_START)
      const found: RadarHit[] = []
      try {
        for (const [i, id] of unseen.entries()) {
          const m = await this.google.fetchJson<GmailMessage>(`${API}/messages/${encodeURIComponent(id)}?format=full`).catch((e: Error) => {
            // Read the rest next time rather than losing them.
            for (const left of unseen.slice(i)) this.deps.db.forgetEmail(key, left)
            throw e
          })
          const header = (name: string): string => m.payload?.headers?.find((h) => h.name.toLowerCase() === name)?.value ?? ''
          const from = header('from').replace(/<[^>]*>/g, '').replace(/"/g, '').trim()
          const roles = skipRoles(findRoles(bodyText(m.payload), header('subject'), from, companies), skip)
          found.push(...this.deps.db.addRadarHits(toHits(m.threadId, clip(from, 80), Number(m.internalDate) || Date.now(), roles)))
        }
      } finally {
        if (started && found.length) this.deps.onFound(found)
      }
      this.checkedAt = Date.now()
      this.error = null
      if (found.length) this.deps.log(`job radar: ${found.length} new role${found.length > 1 ? 's' : ''}${started ? '' : ' (first check)'}`)
    } catch (e) {
      const msg = (e as Error).message
      if (msg !== this.error) this.deps.log(`job radar: ${msg}`)
      this.error = msg
    }
  }
}
