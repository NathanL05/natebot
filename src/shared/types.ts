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
  enabled: boolean
  cron: string
  prompt: string
}

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
  routine: Routine | null
  session_id: string | null
}

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

export interface ProposedAction {
  id: string
  type: string
  summary: string
  /** Exact tool that performs it, e.g. "mcp__gmail__send_message". */
  tool?: string
  details: Record<string, unknown>
  status: ActionStatus
  result?: string
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
  /** Group chats only: the agent who wrote this agent message. */
  speakerId?: string
  /** Group chats only: attached files, relative to each member's workspace. */
  files?: string[]
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
}

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
