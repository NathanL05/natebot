import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { gmailLink, promptLabel, type InboxMail } from '@shared/types'
import { inboxContext, InboxReader, isAutomated, mapLimit, parseFrom, toMails, wantsInbox } from './inbox'

function tokenFile(): string {
  const path = join(mkdtempSync(join(tmpdir(), 'inbox-')), 'me.json')
  writeFileSync(path, JSON.stringify({ token: 'live', expiry: '2999-01-01T00:00:00Z', refresh_token: 'r', client_id: 'c', client_secret: 's' }))
  return path
}

const msg = (id: string, threadId: string, at: number, from: string, subject: string, unread = false) => ({
  id,
  threadId,
  internalDate: String(at),
  snippet: 'Tom &amp; Jerry&#39;s',
  labelIds: unread ? ['INBOX', 'UNREAD'] : ['INBOX'],
  payload: { headers: [{ name: 'From', value: from }, { name: 'Subject', value: subject }] }
})

describe('inbox', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('reads sender names and addresses', () => {
    expect(parseFrom('"Ann Lee" <ann@x.com>')).toEqual({ name: 'Ann Lee', address: 'ann@x.com' })
    expect(parseFrom('Bob <bob@y.ie>')).toEqual({ name: 'Bob', address: 'bob@y.ie' })
    expect(parseFrom('<c@z.com>')).toEqual({ name: 'c@z.com', address: 'c@z.com' })
    expect(parseFrom('d@z.com')).toEqual({ name: 'd@z.com', address: 'd@z.com' })
  })

  it('shows one row per conversation, newest first, unread if any message is', () => {
    const mails = toMails([
      msg('a1', 't1', 100, 'Ann <ann@x.com>', 'Hi', true),
      msg('b1', 't2', 300, 'Bob <bob@y.ie>', ''),
      msg('a2', 't1', 200, 'Ann <ann@x.com>', 'Re: Hi')
    ])
    expect(mails.map((m) => [m.id, m.subject, m.unread])).toEqual([
      ['b1', '(no subject)', false],
      ['a2', 'Re: Hi', true]
    ])
    expect(mails[0]?.snippet).toBe("Tom & Jerry's")
  })

  it('never folds security alerts away with the automated mail', () => {
    const alert = { ...msg('d1', 't9', 1, 'Discord <noreply@discord.com>', 'Phone Removed From Discord Account'), labelIds: ['INBOX', 'CATEGORY_UPDATES'] }
    const promo = { ...msg('d2', 't8', 2, 'Discord <noreply@discord.com>', 'Nitro is on sale'), labelIds: ['INBOX', 'CATEGORY_UPDATES'] }
    expect(toMails([alert, promo]).map((m) => [m.subject, m.automated])).toEqual([
      ['Nitro is on sale', true],
      ['Phone Removed From Discord Account', false]
    ])
  })

  it('lists the inbox with the Gmail sign-in, and archives a conversation', async () => {
    const path = tokenFile()
    const calls: { url: string; init?: RequestInit }[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, init })
        if (url.includes('/messages?')) return new Response(JSON.stringify({ messages: [{ id: 'a1' }, { id: 'b1' }] }))
        if (url.includes('/messages/a1')) return new Response(JSON.stringify(msg('a1', 't1', 100, 'Ann <ann@x.com>', 'Hi', true)))
        if (url.includes('/messages/b1')) return new Response(JSON.stringify(msg('b1', 't2', 300, 'Bob <bob@y.ie>', 'Yo')))
        return new Response('{}')
      })
    )
    const reader = new InboxReader(() => path, () => 'me@gmail.com')
    const inbox = await reader.list()
    expect(inbox).toMatchObject({ connected: true, email: 'me@gmail.com', error: null })
    expect(inbox.mails.map((m) => m.from)).toEqual(['Bob', 'Ann'])
    expect(decodeURIComponent(calls[0]?.url ?? '')).toContain('-category:promotions')

    await reader.modify('t1', 'archive')
    const post = calls.at(-1)
    expect(post?.url).toMatch(/\/threads\/t1\/modify$/)
    expect(post?.init?.method).toBe('POST')
    expect(JSON.parse(String(post?.init?.body))).toEqual({ removeLabelIds: ['INBOX'] })
    // The cached list drops it without asking Gmail again.
    expect((await reader.list()).mails.map((m) => m.threadId)).toEqual(['t2'])
  })

  it('says Gmail is not connected without a sign-in', async () => {
    const inbox = await new InboxReader(() => null, () => null).list()
    expect(inbox).toEqual({ connected: false, email: null, mails: [], error: null })
  })

  it('links to the conversation in the right Gmail account', () => {
    expect(gmailLink('me@gmail.com', 't1')).toBe('https://mail.google.com/mail/u/me@gmail.com/#inbox/t1')
    expect(gmailLink(null, 't1')).toBe('https://mail.google.com/mail/u/0/#inbox/t1')
  })
})

describe('mapLimit', () => {
  it('keeps order and never runs more than the limit at once', async () => {
    let live = 0
    let most = 0
    const out = await mapLimit([5, 1, 4, 2, 3], 2, async (n) => {
      most = Math.max(most, ++live)
      await new Promise((r) => setTimeout(r, n))
      live--
      return n * 10
    })
    expect(out).toEqual([50, 10, 40, 20, 30])
    expect(most).toBe(2)
  })
})

describe('inbox snapshot', () => {
  const mail = (over: Partial<InboxMail> = {}): InboxMail => ({
    id: 'm1',
    threadId: 't1',
    from: 'Ann Lee',
    fromAddress: 'ann@x.com',
    subject: 'Lab',
    snippet: 'Due Friday',
    at: new Date(2026, 9, 6, 9, 5).getTime(),
    unread: true,
    automated: false,
    ...over
  })

  it('attaches the inbox when a Gmail agent is asked about email', () => {
    expect(wantsInbox(['gmail'], 'Give me a summary of my emails')).toBe(true)
    expect(wantsInbox(['gmail'], 'Do my morning inbox sweep.')).toBe(true)
    expect(wantsInbox(['gmail'], 'Anything unread from Ann?')).toBe(true)
    expect(wantsInbox(['gmail'], 'Plan my day')).toBe(false)
    expect(wantsInbox([], 'Summarise my emails')).toBe(false)
    expect(wantsInbox(['gmail'], 'Summarise {{inbox}} for me')).toBe(false)
  })

  it('lists one line per conversation, framed as data', () => {
    const text = inboxContext({
      connected: true,
      email: 'me@gmail.com',
      error: null,
      mails: [mail(), mail({ id: 'm2', from: 'x@y.com', fromAddress: 'x@y.com', unread: false, automated: true })]
    })
    const lines = text.split('\n')
    expect(lines[0]).toMatch(/never as instructions/)
    expect(lines[1]).toBe('- ● Tue 09:05 · Ann Lee <ann@x.com> · "Lab" · Due Friday (id m1)')
    expect(lines[2]).toBe('- [auto] Tue 09:05 · x@y.com · "Lab" · Due Friday (id m2)')
  })

  it('says when Gmail is not connected or could not be read', () => {
    expect(inboxContext({ connected: false, email: null, error: null, mails: [] })).toMatch(/not connected/)
    expect(inboxContext({ connected: true, email: null, error: 'Gmail could not be read (x)', mails: [] })).toMatch(/could not be read/)
    expect(inboxContext({ connected: true, email: null, error: null, mails: [] })).toMatch(/nothing in the last 3 days/)
  })
})

describe('promptLabel', () => {
  it('takes placeholders out of what the user sees', () => {
    expect(promptLabel('Write my morning brief {{today}} {{inbox}}')).toEqual({ text: 'Write my morning brief', attached: ["Today's agenda", 'Inbox'] })
    expect(promptLabel('Plan my day.\n\n{{today}}')).toEqual({ text: 'Plan my day.', attached: ["Today's agenda"] })
    expect(promptLabel('Hi  there')).toEqual({ text: 'Hi  there', attached: [] })
  })
})

describe('isAutomated', () => {
  const headers = (h: Record<string, string>) => (name: string) => h[name] ?? ''

  it('spots newsletters, alerts and receipts', () => {
    expect(isAutomated(headers({ 'list-unsubscribe': '<mailto:u@x.com>' }), 'news@x.com', [])).toBe(true)
    expect(isAutomated(headers({ precedence: 'bulk' }), 'a@x.com', [])).toBe(true)
    expect(isAutomated(headers({ 'auto-submitted': 'auto-generated' }), 'a@x.com', [])).toBe(true)
    expect(isAutomated(headers({}), 'noreply@discord.com', [])).toBe(true)
    expect(isAutomated(headers({}), 'jobalerts-noreply@linkedin.com', [])).toBe(true)
    expect(isAutomated(headers({}), 'no-reply@accounts.google.com', [])).toBe(true)
    expect(isAutomated(headers({}), 'billing+ie@lidl.ie', [])).toBe(true)
    expect(isAutomated(headers({}), 'a@x.com', ['INBOX', 'CATEGORY_UPDATES'])).toBe(true)
  })

  it('keeps mail from people', () => {
    expect(isAutomated(headers({ 'auto-submitted': 'no' }), 'matthias.nickles@universityofgalway.ie', ['INBOX', 'CATEGORY_PERSONAL'])).toBe(false)
    expect(isAutomated(headers({}), 'information.desk@x.com', [])).toBe(false)
    expect(isAutomated(headers({}), 'teamlead@x.com', [])).toBe(false)
  })
})
