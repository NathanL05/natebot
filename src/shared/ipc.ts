// The whole renderer <-> main contract. The preload exposes exactly these
// methods and events, nothing else.
import type {
  Agenda,
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
  Inbox,
  Job,
  MarketplaceData,
  McpServerInfo,
  MessageHit,
  Reminder,
  RoomConfig,
  RoomDraft,
  RoomSummary,
  RoutineInfo,
  RoutineRun,
  UsageBreakdown,
  UsageInfo
} from './types'

export interface NateBotApi {
  bootstrap(): Promise<Bootstrap>
  // The chat methods take an agent id or a group chat (room) id.
  /** The latest HISTORY_PAGE messages, oldest first. */
  listMessages(chatId: string): Promise<ChatMessage[]>
  /** Up to OLDER_PAGE messages from before `beforeId`, oldest first; `more` if there are older ones still. */
  olderMessages(chatId: string, beforeId: string): Promise<{ messages: ChatMessage[]; more: boolean }>
  /** replyTo: the id of an earlier message in this chat that this one answers. */
  sendMessage(chatId: string, text: string, attachments?: string[], replyTo?: string): Promise<void>
  stop(chatId: string): Promise<void>
  markRead(chatId: string): Promise<void>
  /** Deletes a chat's messages (pinned ones stay) and starts a fresh conversation. Refused while it's working. */
  clearMessages(chatId: string): Promise<void>
  /** Agent messages with actions or handoffs waiting for the user (for the Today screen). */
  pendingMessages(): Promise<ChatMessage[]>
  /** Today's events and tasks from connected calendars and task lists (no Claude run). */
  todayAgenda(refresh?: boolean): Promise<Agenda>
  /** Recent Gmail conversations for Today's Inbox, read directly (no Claude run). */
  inbox(refresh?: boolean): Promise<Inbox>
  /** Archives or marks read a Gmail conversation the user clicked. */
  inboxAction(threadId: string, change: 'archive' | 'read'): Promise<{ ok: boolean; error?: string }>
  /** Saves text to a file the user picks (Markdown by default). */
  saveText(suggestedName: string, text: string): Promise<{ ok: boolean; path?: string }>
  /** Saves text as a new Apple note. */
  saveToNotes(title: string, text: string): Promise<{ ok: boolean; error?: string }>
  /** Pins or unpins a message. */
  setPinned(messageId: string, pinned: boolean): Promise<void>
  /** A chat's pinned messages, newest first. */
  pinnedMessages(chatId: string): Promise<ChatMessage[]>
  /** The job tracker, most recently changed first. */
  listJobs(): Promise<Job[]>
  /** Edits a job from the tracker screen (status, deadline, notes…). */
  updateJob(job: Job): Promise<void>
  deleteJob(jobId: string): Promise<void>
  /** Creates the Job Hunter agent (Haiku, Gmail, daily routine and an interview trigger). Returns its id. */
  createJobHunter(): Promise<string>
  /** Creates the Morning Brief agent (Haiku, daily 7:30, fed today's agenda). Returns its id. */
  createMorningBrief(): Promise<string>
  /** Sets up the Career Board group chat: four brutally honest agents who read your plan folders. Returns its id, or null if no folder was picked. */
  createCareerBoard(): Promise<string | null>
  /** Message text search across every chat (at least 2 characters). */
  searchMessages(query: string): Promise<MessageHit[]>
  /** Native file picker (multiple files). Returns absolute paths. */
  pickAttachments(): Promise<string[]>
  /** Picks a folder for an agent to read. Returns its path, or null if cancelled. */
  pickFolder(): Promise<string | null>

  createAgent(draft: AgentDraft): Promise<AgentConfig>
  updateAgent(agent: AgentConfig): Promise<AgentConfig>
  deleteAgent(agentId: string): Promise<void>
  resetMemory(agentId: string): Promise<void>
  /** Saves the agent as a shareable .natebot.json file (no memory, chat or personal settings). */
  exportAgent(agentId: string): Promise<{ ok: boolean; path?: string }>
  /** Reads a shared agent file the user picks, as a draft for the New agent form (null if cancelled). */
  importAgentFile(): Promise<{ draft?: AgentDraft; error?: string } | null>
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

  /** 'always' approves it and lets this agent use the same tool without asking from now on. */
  resolveAction(
    messageId: string,
    actionId: string,
    decision: 'approve' | 'reject' | 'always',
    details?: Record<string, unknown>
  ): Promise<void>

  /** Sends (or dismisses) a task an agent proposed handing to another agent. */
  resolveHandoff(messageId: string, handoffId: string, decision: 'send' | 'dismiss'): Promise<void>

  listRoutines(): Promise<RoutineInfo[]>
  /** A routine's last 20 runs, newest first. */
  routineHistory(agentId: string, routineId: string): Promise<RoutineRun[]>
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
  /** Sends a test phone notification to the saved ntfy topic. */
  testPush(): Promise<{ ok: boolean; error?: string }>
  /** What's on the clipboard for the quick-capture box: text (cut short), and a copied image saved as a temporary PNG. */
  readClipboard(): Promise<{ text: string | null; imagePath: string | null }>
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
  /** Calendar ('gcal'), Tasks ('gtasks') or Drive ('gdrive'), which share Gmail's address and OAuth client. */
  googleStatus(server: string): Promise<GmailStatus>
  /** Adds the Apple Reminders & Notes connector after macOS grants permission. */
  connectApple(): Promise<{ ok: boolean; error?: string }>
  connectGoogle(server: string): Promise<{ ok: boolean; error?: string }>
}

export const API_METHODS = [
  'bootstrap',
  'listMessages',
  'olderMessages',
  'sendMessage',
  'stop',
  'markRead',
  'clearMessages',
  'searchMessages',
  'todayAgenda',
  'inbox',
  'inboxAction',
  'saveText',
  'saveToNotes',
  'setPinned',
  'pinnedMessages',
  'listJobs',
  'updateJob',
  'deleteJob',
  'createJobHunter',
  'createMorningBrief',
  'createCareerBoard',
  'pendingMessages',
  'pickAttachments',
  'pickFolder',
  'createAgent',
  'updateAgent',
  'deleteAgent',
  'resetMemory',
  'exportAgent',
  'importAgentFile',
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
  'routineHistory',
  'setRoutineEnabled',
  'runRoutineNow',
  'listReminders',
  'cancelReminder',
  'updateSettings',
  'recheckEnv',
  'refreshUsage',
  'usageBreakdown',
  'openExternal',
  'testPush',
  'hideCapture',
  'readClipboard',
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
  'connectCalendar',
  'googleStatus',
  'connectApple',
  'connectGoogle'
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
  navigate: 'settings' | 'routines' | 'today' | 'jobs' | 'guide' | 'newAgent' | 'newRoom'
  /** The quick-capture box was opened, optionally pre-filled from a natebot:// link. */
  captureShown: { at: number; text?: string; agent?: string }
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
