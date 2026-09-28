// Types shared by the main process, preload and renderer.
import type { MascotShape } from './mascot'

export type { MascotShape }

export type ModelId = 'sonnet' | 'haiku' | 'opus'
export const MODELS: { id: ModelId; label: string; hint: string }[] = [
  { id: 'haiku', label: 'Haiku', hint: 'Fastest, lightest on usage' },
  { id: 'sonnet', label: 'Sonnet', hint: 'Balanced (recommended)' },
  { id: 'opus', label: 'Opus', hint: 'Most capable, heaviest on usage' }
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
  attachments?: string[]
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
  theme: Theme
  launchAtLogin: boolean
  userName: string
}

export interface UsageInfo {
  /** 'allowed' | 'allowed_warning' | 'rejected' as reported by the CLI */
  status: string
  resetsAt: number | null
  fiveHourUtilization: number | null
  sevenDayUtilization: number | null
  updatedAt: number
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
  routine: Routine
  nextRun: number | null
  lastRun: { at: number; ok: boolean; summary: string } | null
}

export interface Bootstrap {
  agents: AgentSummary[]
  settings: AppSettings
  mcpServers: McpServerInfo[]
  env: EnvStatus
  usage: UsageInfo | null
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
  uvInstalled: boolean
}
