// Builds a demo NateBot data folder full of made-up agents and chats, for README screenshots.
// Nothing here is real: "Alex", the people and the emails are invented.
//
//   npm run demo:data -- /tmp/natebot-demo        (wipes and rebuilds that folder)
//   NATEBOT_HOME=/tmp/natebot-demo npm run dev    (runs NateBot on it, next to the installed app)
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { Agenda, AgentConfig, ChatMessage, Inbox, Reminder } from '@shared/types'
import { serialize } from '../src/main/agents'
import { Db } from '../src/main/db'

const home = resolve(process.argv[2] ?? '')
if (!process.argv[2] || home === resolve(process.env['HOME'] ?? '', 'NateBot')) {
  console.error('Usage: npm run demo:data -- <empty demo folder> (never your real ~/NateBot)')
  process.exit(1)
}
rmSync(home, { recursive: true, force: true })
mkdirSync(join(home, 'agents'), { recursive: true })

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR
const now = Date.now()
/** Today (or `days` ago) at hh:mm, kept in the past. */
const at = (h: number, m: number, days = 0): number => {
  const d = new Date(now - days * DAY)
  d.setHours(h, m, 0, 0)
  return Math.min(d.getTime(), now - 5 * MIN)
}
const weekday = (t: number): string => new Date(t).toLocaleDateString('en-GB', { weekday: 'long' })
let n = 0
const id = (): string => `demo-${++n}`

// ---- settings ----
writeFileSync(
  join(home, 'settings.json'),
  JSON.stringify(
    {
      userName: 'Alex Morgan',
      theme: 'dark',
      accent: 'violet',
      quickCapture: null,
      aboutMe: 'Final-year student in Dublin. Part-time barista. Short answers, ✓ checklists.'
    },
    null,
    2
  )
)

// ---- agents ----
const agent = (a: Partial<AgentConfig> & Pick<AgentConfig, 'id' | 'name' | 'shape' | 'color' | 'instructions'>): AgentConfig => ({
  model: 'haiku',
  effort: 'low',
  mcp_servers: [],
  allowed_tools: [],
  disallowed_tools: [],
  quick_prompts: [],
  routines: [],
  email_triggers: [],
  read_folders: [],
  session_id: null,
  ...a
})
const agents: AgentConfig[] = [
  agent({
    id: 'email-agent',
    name: 'Email Agent',
    shape: 'hexagon',
    color: '#F5A524',
    model: 'sonnet',
    effort: 'medium',
    instructions: 'You review my Gmail inbox, flag anything urgent and draft replies. Never send without my approval.',
    quick_prompts: ['Give me a summary of my emails', 'Anything urgent I need to reply to?'],
    routines: [{ id: 'main', enabled: true, cron: '0 8 * * 1-5', prompt: 'Do my morning inbox sweep. {{inbox}}' }]
  }),
  agent({
    id: 'morning-brief',
    name: 'Morning Brief',
    shape: 'circle',
    color: '#FFB224',
    instructions: 'Each morning, a short brief of my day.',
    routines: [{ id: 'main', enabled: true, cron: '30 7 * * *', prompt: 'Write my morning brief. {{today}}' }]
  }),
  agent({ id: 'planner', name: 'Planner', shape: 'pill', color: '#5E8BFF', model: 'sonnet', instructions: 'You plan my day and week.', quick_prompts: ['Plan my day', 'Plan my week'] }),
  agent({ id: 'travel-planner', name: 'Travel Planner', shape: 'cloud', color: '#2EC4B6', instructions: 'You plan trips on a student budget.' }),
  agent({ id: 'budget-buddy', name: 'Budget Buddy', shape: 'square', color: '#22C55E', instructions: 'You keep my spending on track.' }),
  agent({ id: 'study-buddy', name: 'Study Buddy', shape: 'triangle', color: '#FF6B6B', instructions: 'You quiz me and make flashcards.' }),
  agent({ id: 'straight-talk', name: 'Straight Talk', shape: 'blob', color: '#9B82FF', model: 'sonnet', instructions: 'Brutally honest mentor. Verdict first.' })
]
for (const a of agents) writeFileSync(join(home, 'agents', `${a.id}.yaml`), serialize(a))

// ---- chats ----
const db = new Db(join(home, 'data.db'))
const say = (agentId: string, role: ChatMessage['role'], text: string, createdAt: number, extra: Partial<ChatMessage> = {}): ChatMessage => {
  const m: ChatMessage = { id: id(), agentId, role, text, createdAt, ...extra }
  db.saveMessage(m)
  return m
}
const routineRun = (agentId: string, msg: ChatMessage, summary: string): void => {
  const runId = id()
  db.startRun(runId, agentId, 'routine', 'main')
  db.finishRun(runId, true, summary, null, msg.id)
  db.raw.prepare('UPDATE runs SET started_at = ?, ended_at = ? WHERE id = ?').run(msg.createdAt - MIN, msg.createdAt, runId)
}

// Email Agent: yesterday's sweep, a reminder, and this morning's question with a reply waiting for approval.
const sweep = say(
  'email-agent',
  'agent',
  '**Morning sweep** ✓\n\n- ✓ Nothing urgent overnight\n- ✓ Your return to Zalando was refunded (€34.99)\n- ✓ Council tax is due this week',
  at(8, 0, 1)
)
routineRun('email-agent', sweep, 'Nothing urgent overnight')
const tomorrow7 = new Date(now + DAY)
tomorrow7.setHours(19, 0, 0, 0)
say('email-agent', 'user', `Remind me ${weekday(tomorrow7.getTime())} at 7pm to pay the council tax`, at(18, 20, 1))
const remMsg = say('email-agent', 'agent', `Done. I'll remind you ${weekday(tomorrow7.getTime())} at 7:00 PM.`, at(18, 20, 1) + 20_000)
const reminder: Reminder = {
  id: id(),
  agentId: 'email-agent',
  messageId: remMsg.id,
  at: tomorrow7.getTime(),
  kind: 'message',
  text: 'Pay the council tax (due this week).',
  status: 'scheduled'
}
db.saveReminder(reminder)
db.saveMessage({ ...remMsg, reminders: [reminder] })

say('email-agent', 'user', 'Anything urgent I need to reply to?', at(9, 14))
say(
  'email-agent',
  'agent',
  [
    'Two things need you today:',
    '',
    '**Urgent**',
    '- ✓ **Sam Rivera** (landlord): the plumber can come **Thursday 9–11am**. He needs a yes by tonight.',
    "- ✓ **Dr Patel's surgery**: your appointment moved to **Friday 14:30**. No reply needed.",
    '',
    '**Can wait**',
    '- ✓ Library: 2 books due Monday',
    '- ✓ 6 newsletters and 3 receipts, nothing to do',
    '',
    "I've drafted a reply to Sam. Approve it below and I'll send it."
  ].join('\n'),
  at(9, 14) + 25_000,
  {
    tools: [{ id: id(), name: 'mcp__gmail__get_gmail_message_content', summary: 'Re: Plumber visit', status: 'done' }],
    actions: [
      {
        id: id(),
        type: 'send_email',
        summary: 'Reply to Sam: Thursday 9–11 works',
        tool: 'mcp__gmail__send_gmail_message',
        details: {
          to: 'sam.rivera@example.com',
          subject: 'Re: Plumber visit',
          body: "Hi Sam,\n\nThursday 9–11am works for me, I'll be home.\n\nThanks,\nAlex"
        },
        status: 'pending'
      }
    ]
  }
)

// Morning Brief: today's brief (shown at the top of Today).
const brief = say(
  'morning-brief',
  'agent',
  [
    `**${weekday(now)} at a glance** · 14°, rain after 4pm`,
    '',
    '- ✓ 10:00 Seminar: Distributed Systems',
    '- ✓ 13:00 Lunch with Priya',
    '- ✓ 17:30–21:00 Shift at the café',
    '- ✓ Reply to Sam about the plumber (draft ready)',
    '',
    '**One suggestion:** you have 2 free hours after lunch. Use them for the essay intro.'
  ].join('\n'),
  at(7, 30)
)
routineRun('morning-brief', brief, 'Brief: 4 items, a reply waiting')

// Planner
say('planner', 'user', 'Plan my day', at(8, 40))
say(
  'planner',
  'agent',
  'Here\'s a realistic day:\n\n- ✓ 08:45–09:45 Essay: outline the intro\n- ✓ 10:00 Seminar\n- ✓ 11:30–12:45 Problem set 4\n- ✓ 13:00 Lunch with Priya\n- ✓ 14:30–16:00 Essay: write the intro\n- ✓ 17:30 Café shift\n\nOne question: gym before the seminar, or skip today?',
  at(8, 41)
)

// Study Buddy (unread)
say('study-buddy', 'user', 'Quiz me on cellular respiration, 5 questions', at(21, 5, 1))
say(
  'study-buddy',
  'agent',
  'Here we go. Answer in one line each:\n\n1. Where does glycolysis happen?\n2. Net ATP from glycolysis?\n3. What is the final electron acceptor?\n4. Which stage makes the most ATP?\n5. What does pyruvate become before the Krebs cycle?',
  at(21, 6, 1)
)
db.bumpUnread('study-buddy')
db.bumpUnread('study-buddy')

// Budget Buddy
say('budget-buddy', 'user', 'How am I doing this month?', at(20, 10, 2))
say(
  'budget-buddy',
  'agent',
  "You've spent **€212 of €400** on food with 12 days to go, so about €16 a day from here. Transport is on track. Coffee out is €48, double last month.",
  at(20, 11, 2)
)

// Straight Talk
say('straight-talk', 'user', 'I keep putting off the gym. Be honest.', at(22, 30, 3))
say(
  'straight-talk',
  'agent',
  "**Verdict:** you don't have a motivation problem, you have a scheduling one. You've said \"this week\" three weeks running.\n\n**Next step:** book Thursday 7am now and tell me when it's done.",
  at(22, 31, 3)
)

// Travel Planner
say('travel-planner', 'user', 'Cheapest weekend to fly Dublin to Lisbon in May?', at(19, 0, 4))
say('travel-planner', 'agent', 'May 15–18 is the sweet spot: about €130 return if you book by early March. The 22nd is a bank holiday weekend and twice the price.', at(19, 1, 4))

// Group chat: three agents plan a trip together.
const room = { id: 'room:lisbon-weekend', name: 'Lisbon weekend', memberIds: ['travel-planner', 'budget-buddy', 'planner'], maxTurns: 6 }
db.saveRoom(room)
const t = at(19, 40)
say(room.id, 'user', 'Lisbon for a long weekend in May. Thoughts? Budget around €600.', t)
say(
  room.id,
  'agent',
  'Love it. Fly Friday evening, back Monday. Stay in **Alfama** for the views or **Príncipe Real** for food. Do Belém early on Saturday before the crowds, and Sintra on Sunday.',
  t + 30_000,
  { speakerId: 'travel-planner' }
)
say(
  room.id,
  'agent',
  "€600 works with a guesthouse: €70 × 3 nights = €210, flights €130, food €40/day, Sintra train and entry €35. That's about **€535**, with some slack. @Travel Planner, is Sintra worth it over a slow day in the city?",
  t + 60_000,
  { speakerId: 'budget-buddy' }
)
say(
  room.id,
  'agent',
  "For a first visit, yes, but take the 9am train or it's packed. If money's tight, Cascais is €4 by train and has beaches.",
  t + 90_000,
  { speakerId: 'travel-planner' }
)
say(
  room.id,
  'agent',
  "I can block **May 15–18** and remind you on 1 March to book the flights. Want that?",
  t + 120_000,
  { speakerId: 'planner' }
)
db.bumpUnread(room.id)

// Today's calendar and inbox, read by a demo copy instead of Google (see Backend.demoToday).
const today = (h: number, m: number): number => new Date(new Date(now).setHours(h, m, 0, 0)).getTime()
const agenda: Agenda = {
  events: [
    { title: 'Seminar: Distributed Systems', start: today(10, 0), end: today(11, 0), allDay: false, location: 'Room 2.14' },
    { title: 'Lunch with Priya', start: today(13, 0), end: today(14, 0), allDay: false, location: null },
    { title: 'Shift at the café', start: today(17, 30), end: today(21, 0), allDay: false, location: null }
  ],
  tasks: [
    { title: 'Problem set 4', due: today(23, 59), source: 'Google Tasks' },
    { title: 'Return library books', due: null, source: 'Reminders' }
  ],
  connected: { calendar: true, tasks: true, reminders: true },
  errors: []
}
const mail = (from: string, subject: string, snippet: string, hoursAgo: number, unread: boolean, automated = false) => ({
  id: id(),
  threadId: id(),
  from,
  fromAddress: `${from.toLowerCase().replace(/[^a-z]+/g, '.')}@example.com`,
  subject,
  snippet,
  at: now - hoursAgo * HOUR,
  unread,
  automated
})
const inbox: Inbox = {
  connected: true,
  email: 'alex@example.com',
  error: null,
  mails: [
    mail('Sam Rivera', 'Re: Plumber visit', 'He can come Thursday 9–11am, can you let me know by tonight?', 10, true),
    mail('Priya Shah', 'Lunch tomorrow?', 'Same place as last time? I can do 1pm.', 26, false),
    mail("Dr Patel's Surgery", 'Appointment change', 'Your appointment has moved to Friday at 14:30.', 12, true),
    mail('Library', 'Items due soon', '2 items are due back on Monday.', 30, false, true),
    mail('Zalando', 'Your refund is on its way', "We've refunded €34.99 to your card.", 34, false, true)
  ]
}
writeFileSync(join(home, 'demo-today.json'), JSON.stringify({ agenda, inbox }, null, 2))

db.close()
console.log(`Demo data written to ${home}`)
