// Types shared by the main process, preload and renderer.
import type { AccentId } from './accents'
import type { MascotShape } from './mascot'

export type { AccentId, MascotShape }

export type ModelId = 'sonnet' | 'haiku' | 'opus'
export const MODELS: { id: ModelId; label: string; hint: string }[] = [
  { id: 'haiku', label: 'Haiku', hint: 'Fastest, lightest on usage' },
  { id: 'sonnet', label: 'Sonnet', hint: 'Balanced (recommended)' },
  { id: 'opus', label: 'Opus', hint: 'Most capable, heaviest on usage' }
]

/** Full model names passed to the CLI, so an agent stays on the same model when an alias moves on. */
export const MODEL_IDS: Record<ModelId, string> = {
  haiku: 'claude-haiku-4-5-20251001',
  sonnet: 'claude-sonnet-5-5',
  opus: 'claude-opus-5-5'
}

export type EffortLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max'
export const DEFAULT_EFFORT: EffortLevel = 'medium'
export const EFFORTS: { id: EffortLevel; label: string; hint: string }[] = [
  { id: 'low', label: 'Low', hint: 'Fastest and cheapest: quick lookups and simple replies' },
  { id: 'medium', label: 'Medium', hint: 'Balanced (recommended): summaries, planning, research' },
  { id: 'high', label: 'High', hint: 'Thinks longer: tricky analysis and writing' },
  { id: 'xhigh', label: 'Extra', hint: 'Very thorough, uses your limit quickly' },
  { id: 'max', label: 'Max', hint: 'Deepest reasoning, heaviest on usage' }
]

export interface Routine {
  /** Stable within its agent (checkpoints and run history use it). The first routine is "main". */
  id: string
  enabled: boolean
  cron: string
  prompt: string
}

/**
 * Wakes an agent when new email matches a Gmail search. NateBot checks Gmail itself
 * every few minutes (no Claude run), and only runs the agent when something matches.
 */
/** Re-reads a web page on a schedule and runs the agent when new text appears. */
export interface WebWatch {
  id: string
  enabled: boolean
  url: string
  /** Hours between checks: one of WATCH_INTERVALS. */
  every: number
  /** Comma-separated words: only run when the new text mentions one. Empty = any change. */
  match: string
  /** What the agent should do with the change. */
  prompt: string
}

export const MAX_WEB_WATCHES = 3
/** Most runs one page watch may start per day, however often the page changes. */
export const MAX_WATCH_RUNS_PER_DAY = 4
export const WATCH_INTERVALS = [1, 3, 6, 24] as const

export interface EmailTrigger {
  id: string
  enabled: boolean
  /** A Gmail search, e.g. "from:linkedin.com subject:interview". */
  query: string
  /** What the agent should do with the matching emails. */
  prompt: string
}

export const MAX_EMAIL_TRIGGERS = 3
export const MAX_READ_FOLDERS = 5

/** Mirrors ~/NateBot/agents/<id>.yaml */
export interface AgentConfig {
  id: string
  name: string
  /** Mascot shape; null = derived from the name. */
  shape: MascotShape | null
  color: string
  model: ModelId
  effort: EffortLevel
  instructions: string
  mcp_servers: string[]
  allowed_tools: string[]
  disallowed_tools: string[]
  /** One-click messages shown above the composer and in the menu bar, up to MAX_QUICK_PROMPTS. */
  quick_prompts: string[]
  /** Scheduled runs, up to MAX_ROUTINES. */
  routines: Routine[]
  /** Runs when new email matches, up to MAX_EMAIL_TRIGGERS (needs Gmail). */
  email_triggers: EmailTrigger[]
  /** Folders on this Mac the agent may read (never change), e.g. a career-plans folder. Absolute paths. */
  read_folders: string[]
  /** Approval-only tools (mcp__server__tool) whose proposals NateBot approves for you ("Always allow"). */
  auto_approve?: string[]
  /** Web pages NateBot re-reads itself, running the agent when they change, up to MAX_WEB_WATCHES. */
  web_watches?: WebWatch[]
  session_id: string | null
}

export const MAX_ROUTINES = 20
/** How many messages a chat opens with; older ones load on request. */
export const HISTORY_PAGE = 500
/** How many older messages each "Load older messages" adds. */
export const OLDER_PAGE = 200
export const MAX_QUICK_PROMPTS = 6

export type AgentStatus = 'idle' | 'running'

/** What the sidebar needs: config plus live state. */
export interface AgentSummary extends AgentConfig {
  status: AgentStatus
  queued: number
  unread: number
  lastActivity: number
  lastPreview: string
  /** Set when the agent has an uploaded picture (cache-busting version). */
  avatarVersion: number | null
  /** Sidebar folder, or null for "No folder". */
  folderId: string | null
  /** Proposed actions and handoffs waiting for the user's OK. */
  pending: number
}

/** A sidebar folder grouping agents and group chats. Stored in data.db. */
export interface Folder {
  id: string
  name: string
  collapsed: boolean
}

export type AgentDraft = Omit<AgentConfig, 'id' | 'session_id'>

export interface ToolUse {
  id: string
  /** Raw tool name, e.g. "mcp__gmail__search_threads" or "WebSearch" */
  name: string
  /** Short human summary of the input, never the raw JSON dump */
  summary?: string
  status: 'running' | 'done' | 'error'
}

export type ActionStatus = 'pending' | 'executing' | 'done' | 'failed' | 'rejected'

export interface ReplyRef {
  id: string
  /** Who wrote it: an agent's name, or "You". */
  who: string
  excerpt: string
}

export interface ProposedAction {
  id: string
  type: string
  summary: string
  /** Exact tool that performs it, e.g. "mcp__gmail__send_message". */
  tool?: string
  details: Record<string, unknown>
  status: ActionStatus
  result?: string
  /** Approved by an "Always allow" rule rather than by a click. */
  auto?: boolean
}

export type HandoffStatus = 'pending' | 'sent' | 'dismissed'

/** An agent's proposal to hand a task to another agent, sent only when the user confirms. */
export interface Handoff {
  id: string
  toAgentId: string
  /** The target's name when it was proposed (the id is what counts). */
  toName: string
  task: string
  status: HandoffStatus
}

export type ReminderStatus = 'scheduled' | 'done' | 'cancelled' | 'missed'

/**
 * A one-off reminder an agent set from a chat. 'message' posts its text at that time
 * (no Claude run); 'task' runs the agent then with the text as its prompt.
 */
export interface Reminder {
  id: string
  agentId: string
  /** The agent message that set it. */
  messageId: string
  at: number
  kind: 'message' | 'task'
  text: string
  status: ReminderStatus
  /** Repeating reminders move to their next time after going off, until cancelled. */
  repeat?: ReminderRepeat
}

export type ReminderRepeat = 'daily' | 'weekdays' | 'weekly'
export const REMINDER_REPEATS: ReminderRepeat[] = ['daily', 'weekdays', 'weekly']

export type JobStatus = 'saved' | 'applied' | 'interview' | 'offer' | 'rejected'
export const JOB_STATUSES: { id: JobStatus; label: string }[] = [
  { id: 'saved', label: 'To apply' },
  { id: 'applied', label: 'Applied' },
  { id: 'interview', label: 'Interviewing' },
  { id: 'offer', label: 'Offer' },
  { id: 'rejected', label: 'Closed' }
]

/** A job or internship in the tracker, filled in by agents (```jobs blocks) or by hand. */
export interface Job {
  id: string
  company: string
  role: string
  status: JobStatus
  /** YYYY-MM-DD, or null. */
  deadline: string | null
  link: string | null
  notes: string
  /** The agent that added it (deadline reminders appear in its chat). */
  agentId: string
  createdAt: number
  updatedAt: number
}

export type MessageRole = 'user' | 'agent' | 'system' | 'error'

export interface ChatMessage {
  id: string
  agentId: string
  role: MessageRole
  text: string
  createdAt: number
  streaming?: boolean
  tools?: ToolUse[]
  actions?: ProposedAction[]
  handoffs?: Handoff[]
  /** Reminders this message set (a copy kept in step with the reminders table, for display). */
  reminders?: Reminder[]
  attachments?: string[]
  /** Your message answers this earlier one (a short excerpt is kept for display and for the agent). */
  replyTo?: ReplyRef
  /** Group chats only: the agent who wrote this agent message. */
  speakerId?: string
  /** Group chats only: attached files, relative to each member's workspace. */
  files?: string[]
  /** Pinned by the user, listed in the chat header. */
  pinned?: boolean
}

/** Group chat ids share the message and unread tables with agents; agent ids never contain ":". */
export const ROOM_PREFIX = 'room:'
export const isRoomId = (id: string): boolean => id.startsWith(ROOM_PREFIX)

/** A group chat: the user plus several agents who reply to each other. Stored in data.db. */
export interface RoomConfig {
  id: string
  name: string
  memberIds: string[]
  /** Guardrail: most agent replies per user message. Agents see what's left and the last one wraps up. */
  maxTurns: number
}

export type RoomDraft = Omit<RoomConfig, 'id'>

export interface RoomSummary extends RoomConfig {
  status: AgentStatus
  /** The member currently replying. */
  speakingId: string | null
  unread: number
  lastActivity: number
  lastPreview: string
  folderId: string | null
}

/** A message matching a sidebar search. */
export interface MessageHit {
  messageId: string
  /** An agent or group chat id. */
  chatId: string
  role: 'user' | 'agent'
  /** Group chats: the agent who wrote it. */
  speakerId?: string
  /** The matching part of the text, about a line long. */
  snippet: string
  createdAt: number
}

/** Today's events and tasks for the Today screen, read directly from Google and Apple (no Claude run). */
export interface Agenda {
  events: { title: string; start: number; end: number; allDay: boolean; location: string | null }[]
  tasks: { title: string; due: number | null; source: 'Google Tasks' | 'Reminders' }[]
  /** Which sources are connected (to suggest the others). */
  connected: { calendar: boolean; tasks: boolean; reminders: boolean }
  errors: string[]
}

export interface McpServerInfo {
  name: string
  configured: boolean
  description?: string
}

export type Theme = 'dark' | 'light'

export interface AppSettings {
  claudePath: string | null
  defaultModel: ModelId
  defaultEffort: EffortLevel
  theme: Theme
  /** UI accent colour (see shared/accents.ts). */
  accent: AccentId
  launchAtLogin: boolean
  userName: string
  /** Global shortcut for the quick-capture box (an Electron accelerator), or null for off. */
  quickCapture: string | null
  /** Routines and task reminders run on Haiku at low effort (the agent's own model otherwise). */
  lightRuns: boolean
  /** Skip routines and task reminders once the week's usage reaches this share (0–1), or null for never. */
  pauseRoutinesAt: number | null
  /** A short profile every agent sees (studies, work, goals, preferences). */
  aboutMe: string
  /** ntfy topic that also gets every notification (for your phone), or null for off. */
  pushTopic: string | null
  /** Include notification text, not just the title, in phone notifications. */
  pushDetails: boolean
  /** Accept messages from your phone on "<pushTopic>-in" (needs pushTopic). */
  phoneInbox: boolean
  /** Hold notifications between these local times ("22:30"–"07:30"); null for off. */
  quietHours: { start: string; end: string } | null
  /** Voice for Listen (a macOS voice name), or null for the best natural voice installed. */
  voice: string | null
  /** Speaking speed for Listen (1 = normal). */
  voiceRate: number
}

export const VOICE_RATES = [0.9, 1, 1.15, 1.3]
/** System Settings → Accessibility → Read & Speak (Spoken Content), where better voices are downloaded. */
export const SPOKEN_CONTENT_SETTINGS = 'x-apple.systempreferences:com.apple.Accessibility-Settings.extension?SpokenContent'

export const MAX_ABOUT_ME = 1200

export const PAUSE_LEVELS = [0.5, 0.7, 0.9]

/** The shortcuts offered for quick capture. */
export const QUICK_CAPTURE_SHORTCUTS: { id: string; label: string }[] = [
  { id: 'Alt+Space', label: '⌥ Space' },
  { id: 'Alt+Shift+Space', label: '⌥⇧ Space' },
  { id: 'Control+Alt+Space', label: '⌃⌥ Space' },
  { id: 'Command+Shift+Space', label: '⌘⇧ Space' }
]
export const DEFAULT_QUICK_CAPTURE = 'Alt+Space'

export interface UsageWindow {
  /** 0–1, or null before the first report. */
  utilization: number | null
  resetsAt: number | null
}

export interface UsageInfo {
  /** 'allowed' | 'allowed_warning' | 'rejected' as reported by the CLI */
  status: string
  /** Which window hit its limit (e.g. 'five_hour', 'seven_day') when rejected. */
  limitedWindow: string | null
  /** When runs may start again (overall). */
  resetsAt: number | null
  fiveHour: UsageWindow
  sevenDay: UsageWindow
  updatedAt: number
}

/** One agent's share of NateBot's usage over a period (from its runs' token counts). */
export interface AgentUsage {
  agentId: string
  runs: number
  /** Everything read, cached reads included. */
  inputTokens: number
  outputTokens: number
  /** API-price estimate: weighs models and caching, so it's the fairest share measure. */
  costUsd: number
  /** Runs with no token report (stopped, timed out, or from before tracking). */
  unmeasuredRuns: number
}

export interface UsageBreakdown {
  /** Start of each period: the subscription window's start when known, else the last 5 hours / 7 days. */
  fiveHourSince: number
  sevenDaySince: number
  fiveHour: AgentUsage[]
  sevenDay: AgentUsage[]
}

export interface EnvStatus {
  /** True until the first check at startup has finished. */
  checking?: boolean
  claudeFound: boolean
  claudePath: string | null
  version: string | null
  loggedIn: boolean
  subscriptionType: string | null
  error: string | null
}

/** One routine, for the Routines view. */
/** One finished run of a routine, for its history. */
export interface RoutineRun {
  at: number
  ok: boolean
  summary: string
  /** The reply it produced (null for runs from before this was recorded). */
  messageId: string | null
  /** Input + output tokens, when the run reported them. */
  tokens: number | null
}

export interface RoutineInfo {
  agentId: string
  agentName: string
  shape: MascotShape | null
  color: string
  avatarVersion: number | null
  routine: Routine
  nextRun: number | null
  lastRun: { at: number; ok: boolean; summary: string } | null
}

export interface Bootstrap {
  agents: AgentSummary[]
  rooms: RoomSummary[]
  folders: Folder[]
  settings: AppSettings
  mcpServers: McpServerInfo[]
  env: EnvStatus
  usage: UsageInfo | null
  userAvatarVersion: number | null
}

export interface GmailProgress {
  stage: 'starting' | 'signin' | 'verifying' | 'done' | 'error'
  message: string
  url?: string
}

export interface GmailStatus {
  configured: boolean
  connected: boolean
  email: string | null
  /** Not secret: shown so reconnecting doesn't need retyping. */
  clientId: string | null
  hasSecret: boolean
  uvInstalled: boolean
  /** It was connected, but Google expired or revoked the sign-in: Connect again. */
  expired: boolean
}

export interface MarketplaceSkill {
  /** "<owner/repo>#<folder>" for GitHub skills, "local#<name>" for hand-added ones. */
  id: string
  name: string
  description: string
  source: string
  installed: boolean
  installedName: string | null
  /** Ships helper scripts (these need Bash, which agents don't have by default). */
  hasScripts: boolean
  fileCount: number
}

export interface MarketplaceSource {
  repo: string
  count: number
  error: string | null
}

export interface MarketplaceData {
  skills: MarketplaceSkill[]
  sources: MarketplaceSource[]
  installedCount: number
}

/** A short, plain-text excerpt of a message to quote in a reply. */
export function replyExcerpt(text: string): string {
  const flat = text.replace(/[*_`#>|]/g, '').replace(/\s+/g, ' ').trim()
  return flat.length > 280 ? `${flat.slice(0, 279)}…` : flat
}

/** Tells the agent which earlier message the user is answering, quoted in case it's no longer in its context. */
export function replyNote(reply: ReplyRef): string {
  const whose = reply.who === 'You' ? 'their own earlier message' : 'this earlier message of yours'
  return `[NateBot note: the user is replying to ${whose}, quoted because it may no longer be in your context: "${reply.excerpt}"]`
}
