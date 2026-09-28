// The whole renderer <-> main contract. The preload exposes exactly these
// methods and events, nothing else.
import type {
  AgentConfig,
  AgentDraft,
  AgentSummary,
  AppSettings,
  Bootstrap,
  ChatMessage,
  EnvStatus,
  RoutineInfo,
  UsageInfo
} from './types'

export interface NateBotApi {
  bootstrap(): Promise<Bootstrap>
  listMessages(agentId: string): Promise<ChatMessage[]>
  sendMessage(agentId: string, text: string, attachments?: string[]): Promise<void>
  stop(agentId: string): Promise<void>
  markRead(agentId: string): Promise<void>
  pickAttachment(agentId: string): Promise<string | null>

  createAgent(draft: AgentDraft): Promise<AgentConfig>
  updateAgent(agent: AgentConfig): Promise<AgentConfig>
  deleteAgent(agentId: string): Promise<void>
  resetMemory(agentId: string): Promise<void>

  resolveAction(
    messageId: string,
    actionId: string,
    decision: 'approve' | 'reject',
    details?: Record<string, unknown>
  ): Promise<void>

  listRoutines(): Promise<RoutineInfo[]>
  setRoutineEnabled(agentId: string, enabled: boolean): Promise<void>
  runRoutineNow(agentId: string): Promise<void>

  updateSettings(patch: Partial<AppSettings>): Promise<AppSettings>
  recheckEnv(): Promise<EnvStatus>
  openExternal(url: string): Promise<void>
}

export const API_METHODS = [
  'bootstrap',
  'listMessages',
  'sendMessage',
  'stop',
  'markRead',
  'pickAttachment',
  'createAgent',
  'updateAgent',
  'deleteAgent',
  'resetMemory',
  'resolveAction',
  'listRoutines',
  'setRoutineEnabled',
  'runRoutineNow',
  'updateSettings',
  'recheckEnv',
  'openExternal'
] as const satisfies readonly (keyof NateBotApi)[]

// Compile-time check that API_METHODS lists every method.
type Missing = Exclude<keyof NateBotApi, (typeof API_METHODS)[number]>
const _exhaustive: Missing extends never ? true : Missing = true
void _exhaustive

/** Events pushed from main to renderer. */
export interface NateBotEvents {
  agents: AgentSummary[]
  message: ChatMessage
  usage: UsageInfo
  env: EnvStatus
  /** Main asks the renderer to navigate (e.g. from a notification click). */
  focusAgent: string
  /** Menu shortcuts: Cmd+, / Cmd+N / Routines. */
  navigate: 'settings' | 'routines' | 'newAgent'
}

export const EVENT_NAMES = [
  'agents',
  'message',
  'usage',
  'env',
  'focusAgent',
  'navigate'
] as const satisfies readonly (keyof NateBotEvents)[]

export type Unsubscribe = () => void

export interface NateBotBridge extends NateBotApi {
  on<K extends keyof NateBotEvents>(event: K, cb: (payload: NateBotEvents[K]) => void): Unsubscribe
}
