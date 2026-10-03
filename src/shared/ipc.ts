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
  Folder,
  GmailProgress,
  GmailStatus,
  Job,
  MarketplaceData,
  McpServerInfo,
  MessageHit,
  Reminder,
  RoomConfig,
  RoomDraft,
  RoomSummary,
  RoutineInfo,
  UsageBreakdown,
  UsageInfo
} from './types'

export interface NateBotApi {
  bootstrap(): Promise<Bootstrap>
  // The chat methods take an agent id or a group chat (room) id.
  listMessages(chatId: string): Promise<ChatMessage[]>
  sendMessage(chatId: string, text: string, attachments?: string[]): Promise<void>
  stop(chatId: string): Promise<void>
  markRead(chatId: string): Promise<void>
  /** Agent messages with actions or handoffs waiting for the user (for the Today screen). */
  pendingMessages(): Promise<ChatMessage[]>
  /** The job tracker, most recently changed first. */
  listJobs(): Promise<Job[]>
  /** Edits a job from the tracker screen (status, deadline, notes…). */
  updateJob(job: Job): Promise<void>
  deleteJob(jobId: string): Promise<void>
  /** Creates the Job Hunter agent (Haiku, Gmail, daily routine and an interview trigger). Returns its id. */
  createJobHunter(): Promise<string>
  /** Message text search across every chat (at least 2 characters). */
  searchMessages(query: string): Promise<MessageHit[]>
  /** Native file picker (multiple files). Returns absolute paths. */
  pickAttachments(): Promise<string[]>

  createAgent(draft: AgentDraft): Promise<AgentConfig>
  updateAgent(agent: AgentConfig): Promise<AgentConfig>
  deleteAgent(agentId: string): Promise<void>
  resetMemory(agentId: string): Promise<void>
  /** The agent's lasting notes (memory.md in its workspace). */
  getMemory(agentId: string): Promise<string>
  setMemory(agentId: string, text: string): Promise<void>

  createRoom(draft: RoomDraft): Promise<RoomConfig>
  updateRoom(room: RoomConfig): Promise<RoomConfig>
  deleteRoom(roomId: string): Promise<void>

  createFolder(name: string): Promise<Folder>
  /** Rename or collapse/expand. */
  updateFolder(folder: Folder): Promise<void>
  /** Its chats move to "No folder". */
  deleteFolder(folderId: string): Promise<void>
  /** chatId: an agent or group chat; folderId null = "No folder". */
  moveToFolder(chatId: string, folderId: string | null): Promise<void>

  resolveAction(
    messageId: string,
    actionId: string,
    decision: 'approve' | 'reject',
    details?: Record<string, unknown>
  ): Promise<void>

  /** Sends (or dismisses) a task an agent proposed handing to another agent. */
  resolveHandoff(messageId: string, handoffId: string, decision: 'send' | 'dismiss'): Promise<void>

  listRoutines(): Promise<RoutineInfo[]>
  setRoutineEnabled(agentId: string, routineId: string, enabled: boolean): Promise<void>
  runRoutineNow(agentId: string, routineId: string): Promise<void>
  /** Reminders still waiting to go off, soonest first. */
  listReminders(): Promise<Reminder[]>
  cancelReminder(reminderId: string): Promise<void>

  updateSettings(patch: Partial<AppSettings>): Promise<AppSettings>
  recheckEnv(): Promise<EnvStatus>
  /** Re-reads subscription usage from the CLI (throttled). */
  refreshUsage(): Promise<UsageInfo | null>
  /** Which agents used what in the current session window and week. */
  usageBreakdown(): Promise<UsageBreakdown>
  openExternal(url: string): Promise<void>
  /** Closes the quick-capture box. */
  hideCapture(): Promise<void>
  /** False when the quick-capture shortcut couldn't be registered (another app has it). */
  captureShortcutOk(): Promise<boolean>

  /** target: 'user' or 'agent:<id>'. dataUrl null resets to the default. Returns the new version. */
  setAvatar(target: string, dataUrl: string | null): Promise<number | null>

  marketplace(refresh?: boolean): Promise<MarketplaceData>
  installSkill(id: string): Promise<{ ok: boolean; error?: string }>
  uninstallSkill(name: string): Promise<{ ok: boolean; error?: string }>
  addSkillSource(repo: string): Promise<{ ok: boolean; error?: string }>
  removeSkillSource(repo: string): Promise<void>

  gmailStatus(): Promise<GmailStatus>
  connectGmail(email: string, clientId: string, clientSecret: string): Promise<{ ok: boolean; error?: string }>
  /** Calendar reuses Gmail's address and OAuth client; it has its own sign-in. */
  calendarStatus(): Promise<GmailStatus>
  connectCalendar(): Promise<{ ok: boolean; error?: string }>
}

export const API_METHODS = [
  'bootstrap',
  'listMessages',
  'sendMessage',
  'stop',
  'markRead',
  'searchMessages',
  'listJobs',
  'updateJob',
  'deleteJob',
  'createJobHunter',
  'pendingMessages',
  'pickAttachments',
  'createAgent',
  'updateAgent',
  'deleteAgent',
  'resetMemory',
  'getMemory',
  'setMemory',
  'createRoom',
  'updateRoom',
  'deleteRoom',
  'createFolder',
  'updateFolder',
  'deleteFolder',
  'moveToFolder',
  'resolveAction',
  'resolveHandoff',
  'listRoutines',
  'setRoutineEnabled',
  'runRoutineNow',
  'listReminders',
  'cancelReminder',
  'updateSettings',
  'recheckEnv',
  'refreshUsage',
  'usageBreakdown',
  'openExternal',
  'hideCapture',
  'captureShortcutOk',
  'setAvatar',
  'marketplace',
  'installSkill',
  'uninstallSkill',
  'addSkillSource',
  'removeSkillSource',
  'gmailStatus',
  'connectGmail',
  'calendarStatus',
  'connectCalendar'
] as const satisfies readonly (keyof NateBotApi)[]

// Compile-time check that API_METHODS lists every method.
type Missing = Exclude<keyof NateBotApi, (typeof API_METHODS)[number]>
const _exhaustive: Missing extends never ? true : Missing = true
void _exhaustive

/** Events pushed from main to renderer. */
export interface NateBotEvents {
  agents: AgentSummary[]
  rooms: RoomSummary[]
  folders: Folder[]
  message: ChatMessage
  usage: UsageInfo
  env: EnvStatus
  /** ~/NateBot/mcp.json changed. */
  mcpServers: McpServerInfo[]
  /** Progress of a Google sign-in (Gmail or Calendar). */
  gmailProgress: GmailProgress
  /** Main asks the renderer to navigate (e.g. from a notification click). */
  focusAgent: string
  /** Menu shortcuts: Cmd+, / Cmd+N / Cmd+Shift+N / Routines. */
  navigate: 'settings' | 'routines' | 'today' | 'jobs' | 'newAgent' | 'newRoom'
  /** The quick-capture box was opened (a timestamp, so every opening is a new event). */
  captureShown: number
}

export const EVENT_NAMES = [
  'agents',
  'rooms',
  'folders',
  'message',
  'usage',
  'env',
  'mcpServers',
  'gmailProgress',
  'focusAgent',
  'navigate',
  'captureShown'
] as const satisfies readonly (keyof NateBotEvents)[]

export type Unsubscribe = () => void

export interface NateBotBridge extends NateBotApi {
  on<K extends keyof NateBotEvents>(event: K, cb: (payload: NateBotEvents[K]) => void): Unsubscribe
}
