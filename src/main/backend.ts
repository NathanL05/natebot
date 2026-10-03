// The real NateBot backend: implements the renderer API on top of the agent
// store (YAML), the database (SQLite), the claude engine and the scheduler.
import { app, BrowserWindow, dialog, Notification, powerMonitor, shell } from 'electron'
import { randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, statSync, unwatchFile, watchFile } from 'node:fs'
import { basename, join } from 'node:path'
import type { NateBotApi } from '@shared/ipc'
import type {
  AgentConfig,
  AgentDraft,
  AgentSummary,
  AppSettings,
  Bootstrap,
  ChatMessage,
  EnvStatus,
  Folder,
  GmailStatus,
  MarketplaceData,
  Reminder,
  ReminderStatus,
  RoomConfig,
  RoomDraft,
  RoutineInfo,
  UsageBreakdown,
  UsageInfo,
  UsageWindow
} from '@shared/types'
import { isRoomId } from '@shared/types'
import { describeCron } from '@shared/schedule'
import { AgentStore } from './agents'
import { avatarVersion, removeAvatar, saveAvatar } from './avatars'
import { Db } from './db'
import { Engine, ensureWorkspace, type RunFinished } from './engine'
import { checkEnv, resolveShellPath } from './env'
import { emit } from './ipc'
import { log } from './log'
import * as skills from './skills'
import { calendarStatus, connectCalendar, connectGmail, gmailStatus, googleReady, stopGmailConnect } from './gmail'
import { configuredServersFor, ensureMcpFile, listServers } from './mcp'
import { AGENTS_DIR, DB_FILE, MCP_FILE, ROOT, WORKSPACES_DIR, workspaceOf } from './paths'
import { handoffPrompt } from './handoff'
import { APPROVAL_BUTTONS, APPROVE, approvalNotice, REJECT } from './notices'
import { dueAction, ReminderClock } from './reminders'
import { Rooms } from './rooms'
import { dueRun, Scheduler, syncedCheckpoint } from './scheduler'
import { SettingsStore } from './settings'
import { UsageTracker } from './usage'

const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024
/** After a wake, give the network a moment before catching up on routines. */
const WAKE_DELAY_MS = 15_000
/** A routine that starts this much after its scheduled time is reported as running late. */
const LATE_AFTER_MS = 2 * 60_000

const clock = (ts: number): string => new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

function previewOf(msg: ChatMessage | null): string {
  if (!msg) return ''
  const line = msg.text.split('\n').find((l) => l.trim()) ?? ''
  return line.replace(/[*_`#>]/g, '').trim().slice(0, 140)
}

export class Backend implements NateBotApi {
  readonly settings = new SettingsStore()
  readonly usage = new UsageTracker(() => (this.env.claudeFound && this.env.loggedIn ? this.env.claudePath : null))
  private store = new AgentStore(AGENTS_DIR)
  private db: Db
  private engine: Engine
  private scheduler: Scheduler
  private reminderClock: ReminderClock
  private rooms: Rooms
  private env: EnvStatus = { checking: true, claudeFound: false, claudePath: null, version: null, loggedIn: false, subscriptionType: null, error: 'Checking…' }
  private envOverride: EnvStatus | null = null
  private agentsTimer: NodeJS.Timeout | undefined
  private roomsTimer: NodeJS.Timeout | undefined
  private wakeTimer: NodeJS.Timeout | undefined
  /** Approval notifications still showing, by message id. */
  private approvalNotices = new Map<string, Notification>()
  private onResume = (): void => {
    clearTimeout(this.wakeTimer)
    this.wakeTimer = setTimeout(() => {
      this.catchUpRoutines()
      this.fireReminders()
    }, WAKE_DELAY_MS)
  }
  /** Called whenever the agent list changes (tray menu). */
  onAgentsChanged: (agents: AgentSummary[]) => void = () => undefined
  /** Called when a notification is clicked. */
  onOpenAgent: (agentId: string) => void = () => undefined

  constructor() {
    mkdirSync(ROOT, { recursive: true })
    mkdirSync(WORKSPACES_DIR, { recursive: true })
    ensureMcpFile()
    this.db = new Db(DB_FILE)
    this.db.repairInterrupted()

    this.engine = new Engine({
      store: this.store,
      db: this.db,
      usage: this.usage,
      claudePath: () => (this.env.claudeFound ? this.env.claudePath : null),
      emitMessage: (m) => emit('message', m),
      emitAgents: () => this.emitAgents()
    })
    this.engine.on('runFinished', (r: RunFinished) => this.onRunFinished(r))
    this.engine.on('actionFinished', (r: { agentId: string; ok: boolean; summary: string }) => {
      if (!r.ok) this.notify(r.agentId, 'Action failed', r.summary)
      else if (!this.focused()) this.notify(r.agentId, 'Done', r.summary)
    })

    this.rooms = new Rooms({
      db: this.db,
      store: this.store,
      engine: this.engine,
      usage: this.usage,
      userName: () => this.settings.get().userName,
      emitMessage: (m) => emit('message', m),
      emitRooms: () => this.emitRooms(),
      onIdle: (roomId, replies) => {
        if (replies && !this.focused()) this.notify(roomId, 'New messages', `${replies} new repl${replies > 1 ? 'ies' : 'y'} in the group`)
        void this.usage.refresh()
      }
    })

    this.scheduler = new Scheduler((id) => this.fireRoutine(id, 'tick'))
    this.reminderClock = new ReminderClock(
      () => this.db.nextReminderAt(),
      () => this.fireReminders()
    )
    this.engine.on('remindersChanged', () => this.fireReminders())

    this.usage.on('changed', () => {
      const info = this.usage.get()
      if (info) emit('usage', info)
      if (this.usage.waitMs() === 0) this.engine.pump()
    })

    const seeded = this.store.init()
    if (seeded) {
      for (const a of this.store.list()) {
        ensureWorkspace(a.id)
        this.engine.system(a.id, `Created agent: ${a.name}`)
        if (a.routine?.enabled) this.engine.system(a.id, `Created routine: ${describeCron(a.routine.cron)}`)
      }
    }
    this.store.on('changed', () => {
      this.syncRoutines()
      this.emitAgents()
      this.emitRooms()
    })
    this.syncRoutines()

    // Editors often replace the file, so poll its stat rather than fs.watch.
    watchFile(MCP_FILE, { interval: 1500 }, () => emit('mcpServers', this.serverList()))
  }

  /** mcp.json servers; Gmail only counts as set up once it has a sign-in token. */
  private serverList(): ReturnType<typeof listServers> {
    return listServers().map((s) => (s.name === 'gmail' || s.name === 'gcal' ? { ...s, configured: googleReady(s.name) } : s))
  }

  /** Resolves the shell PATH and checks claude. Runs once at startup. */
  async start(): Promise<void> {
    const path = await resolveShellPath()
    log(`startup: version=${app.getVersion()} packaged=${app.isPackaged} pathDirs=${path.split(':').length}`)
    await this.recheckEnv()
    this.usage.startPolling()
    // Routines only fire while the Mac is awake and NateBot is open: run what was missed.
    this.catchUpRoutines()
    this.fireReminders()
    powerMonitor.on('resume', this.onResume)
  }

  shutdown(): void {
    // Their buttons stop working once NateBot quits, so don't leave them on screen.
    for (const n of this.approvalNotices.values()) n.close()
    this.approvalNotices.clear()
    powerMonitor.off('resume', this.onResume)
    clearTimeout(this.wakeTimer)
    this.usage.stopPolling()
    stopGmailConnect()
    unwatchFile(MCP_FILE)
    this.scheduler.stopAll()
    this.reminderClock.stop()
    this.rooms.shutdown()
    this.engine.shutdown()
    this.store.close()
    this.db.close()
  }

  // ---- dev helpers (Debug menu) ----

  simulateUsageLimit(on: boolean): void {
    this.usage.simulate(on)
  }

  simulateSetupProblem(on: boolean): void {
    this.envOverride = on
      ? { ...this.env, loggedIn: false, error: 'Claude Code is installed but not logged in. (simulated)' }
      : null
    emit('env', this.envOverride ?? this.env)
  }

  // ---- internals ----

  private summaries(): AgentSummary[] {
    return this.store.list().map((a) => {
      const last = this.db.lastMessage(a.id)
      const { running, queued } = this.engine.status(a.id)
      return {
        ...a,
        status: running ? 'running' : 'idle',
        queued,
        unread: this.db.unread(a.id),
        lastActivity: last?.createdAt ?? 0,
        lastPreview: running ? previewOf(this.engine.liveMessage(a.id)) || previewOf(last) : previewOf(last),
        avatarVersion: avatarVersion(`agent:${a.id}`),
        folderId: this.db.folderOf(a.id)
      }
    })
  }

  private emitAgents(): void {
    // Coalesce bursts (streaming, queue changes) into one update.
    if (this.agentsTimer) return
    this.agentsTimer = setTimeout(() => {
      this.agentsTimer = undefined
      const list = this.summaries()
      emit('agents', list)
      this.onAgentsChanged(list)
    }, 30)
  }

  private emitRooms(): void {
    if (this.roomsTimer) return
    this.roomsTimer = setTimeout(() => {
      this.roomsTimer = undefined
      emit('rooms', this.rooms.summaries())
    }, 30)
  }

  private focused(): boolean {
    return BrowserWindow.getAllWindows().some((w) => w.isFocused())
  }

  /** chatId: an agent or a group chat. `buttons` adds macOS action buttons (index of the one pressed). */
  private notify(chatId: string, title: string, body: string, buttons?: { labels: string[]; onAction: (index: number) => void }): Notification | null {
    if (!Notification.isSupported()) return null
    const name = this.store.get(chatId)?.name ?? this.rooms.get(chatId)?.name
    const n = new Notification({
      title: name ? `${name} · ${title}` : title,
      body,
      silent: false,
      ...(buttons ? { actions: buttons.labels.map((text) => ({ type: 'button' as const, text })), closeButtonText: 'Later' } : {})
    })
    n.on('click', () => this.onOpenAgent(chatId))
    if (buttons) n.on('action', (e) => buttons.onAction(e.actionIndex))
    n.show()
    return n
  }

  /**
   * "Needs your approval", with Approve / Reject buttons when there's a single
   * action. Kept by message so approving or rejecting in the app removes it
   * (holding the reference also keeps its button handlers alive).
   */
  private notifyApproval(r: RunFinished): void {
    const notice = approvalNotice(this.db.getMessage(r.messageId)?.actions)
    if (!notice) return
    const { action } = notice
    const buttons = action
      ? {
          labels: APPROVAL_BUTTONS,
          onAction: (index: number): void => {
            if (index === APPROVE) void this.approveFromNotification(r.agentId, r.messageId, action.id)
            else if (index === REJECT) void this.resolveAction(r.messageId, action.id, 'reject')
          }
        }
      : undefined
    const n = this.notify(r.agentId, 'Needs your approval', notice.body, buttons)
    if (!n) return
    this.approvalNotices.get(r.messageId)?.close()
    this.approvalNotices.set(r.messageId, n)
    n.on('close', () => {
      if (this.approvalNotices.get(r.messageId) === n) this.approvalNotices.delete(r.messageId)
    })
  }

  private async approveFromNotification(agentId: string, messageId: string, actionId: string): Promise<void> {
    await this.resolveAction(messageId, actionId, 'approve').catch((e: Error) => log(`approve from notification failed: ${e.message}`))
    // Approval can be refused before it starts: say so outside the app too.
    const still = this.db.getMessage(messageId)?.actions?.find((a) => a.id === actionId)
    if (still?.status !== 'pending') return
    const why = this.usage.waitMs() > 0 ? 'Usage limit reached. Approve it in NateBot after it resets.' : "It couldn't start. Open NateBot to check it."
    this.notify(agentId, 'Not done yet', `${still.summary}: ${why}`)
  }

  /** Removes the approval notification once none of its message's actions are pending. */
  private clearApprovalNotice(messageId: string, msg: ChatMessage): void {
    if (msg.actions?.some((a) => a.status === 'pending')) return
    this.approvalNotices.get(messageId)?.close()
    this.approvalNotices.delete(messageId)
  }

  private onRunFinished(r: RunFinished): void {
    log(`run: agent=${r.agentId} source=${r.source} ok=${r.ok}`)
    void this.usage.refresh()
    if (r.needsApproval) this.notifyApproval(r)
    else if (r.handoffTo) this.notify(r.agentId, 'Suggests a handoff', `Pass a task to ${r.handoffTo}? Open NateBot to review and confirm.`)
    else if (r.source === 'routine') this.notify(r.agentId, r.ok ? 'Routine finished' : 'Routine failed', r.summary)
    else if (r.source === 'reminder') this.notify(r.agentId, 'Reminder', r.summary)
    else if (!this.focused() && r.ok) this.notify(r.agentId, 'Replied', r.summary)
  }

  /**
   * Schedules the enabled routines. A new or changed schedule starts counting
   * from now, so a catch-up never runs a time from before it was set up.
   */
  private syncRoutines(): void {
    const agents = this.store.list()
    const now = Date.now()
    for (const a of agents) {
      const cp = this.db.routineCheckpoint(a.id)
      const next = syncedCheckpoint(a.routine, cp, now)
      if (next !== cp) this.db.setRoutineCheckpoint(a.id, next)
    }
    this.scheduler.sync(agents)
  }

  private catchUpRoutines(): void {
    // A run that can't start would still use up the missed time: wait for a working claude.
    const env = this.envOverride ?? this.env
    if (!env.claudeFound || !env.loggedIn) return
    for (const a of this.store.list()) if (a.routine?.enabled) this.fireRoutine(a.id, 'catch-up')
  }

  private fireRoutine(agentId: string, trigger: 'tick' | 'catch-up'): void {
    const agent = this.store.get(agentId)
    if (!agent?.routine?.enabled) return
    const now = Date.now()
    const due = dueRun(agent.routine.cron, this.db.routineCheckpoint(agentId), now, trigger)
    if (due === null) return
    // From here this scheduled time counts as dealt with, whether it runs or is skipped.
    this.db.setRoutineCheckpoint(agentId, { cron: agent.routine.cron, at: now })
    const late = now - due > LATE_AFTER_MS
    if (late) log(`routine: agent=${agentId} catching up on ${new Date(due).toISOString()} (${trigger})`)
    const time = clock(now)
    const dueText = late ? ` (it was due at ${new Date(due).toDateString() === new Date(now).toDateString() ? '' : 'yesterday at '}${clock(due)})` : ''
    // Don't spend usage on a routine whose tools aren't set up (e.g. Gmail not connected).
    const ready = configuredServersFor(agent).filter((n) => googleReady(n))
    const missing = agent.mcp_servers.filter((n) => !ready.includes(n))
    if (missing.length) {
      this.engine.system(agentId, `Routine skipped at ${time}${dueText}: ${missing.join(', ')} isn't set up yet`)
      this.emitAgents()
      return
    }
    const wait = this.usage.waitMs()
    if (wait > 0) {
      this.engine.system(agentId, `Routine skipped at ${time}${dueText}: usage limit reached (resets at ${clock(now + wait)})`)
      this.emitAgents()
      return
    }
    this.engine.system(agentId, `Routine ran at ${time}${dueText}`)
    this.engine.enqueue(agentId, { source: 'routine', prompt: agent.routine.prompt, attachments: [], ...(late ? { dueAt: due } : {}) })
  }

  /** Sets a reminder's status, and the copy on the message that set it. */
  private setReminderStatus(r: Reminder, status: ReminderStatus): void {
    this.db.setReminderStatus(r.id, status)
    const msg = this.db.getMessage(r.messageId)
    const copy = msg?.reminders?.find((x) => x.id === r.id)
    if (msg && copy) {
      copy.status = status
      this.db.saveMessage(msg)
      emit('message', msg)
    }
  }

  /** Runs every reminder that's due (late ones too, after sleep or a restart), then waits for the next. */
  private fireReminders(): void {
    const now = Date.now()
    for (const r of this.db.scheduledReminders(now)) {
      const what = dueAction(r, now)
      if (!what) continue
      if (!this.store.get(r.agentId)) {
        this.db.setReminderStatus(r.id, 'cancelled')
        continue
      }
      // A task can't run without a working claude: keep it until there is one.
      const env = this.envOverride ?? this.env
      if (what === 'run' && r.kind === 'task' && (!env.claudeFound || !env.loggedIn)) continue
      const due = new Date(r.at).toDateString() === new Date(now).toDateString() ? clock(r.at) : new Date(r.at).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })
      if (what === 'miss') {
        this.setReminderStatus(r, 'missed')
        this.engine.system(r.agentId, `Missed reminder (due ${due}, while the Mac was asleep or NateBot was closed): ${r.text}`)
        continue
      }
      this.setReminderStatus(r, 'done')
      log(`reminder: agent=${r.agentId} kind=${r.kind} late=${now - r.at > LATE_AFTER_MS}`)
      if (r.kind === 'message') {
        this.engine.say(r.agentId, `⏰ ${r.text}`)
        this.notify(r.agentId, 'Reminder', r.text)
      } else {
        this.engine.system(r.agentId, `Reminder ran at ${clock(now)}${now - r.at > LATE_AFTER_MS ? ` (it was due at ${due})` : ''}`)
        this.engine.enqueue(r.agentId, { source: 'reminder', prompt: r.text, attachments: [], dueAt: r.at })
      }
    }
    this.reminderClock.arm()
    this.emitAgents()
  }

  private requireAgent(agentId: unknown): AgentConfig {
    if (typeof agentId !== 'string') throw new Error('Invalid agent id')
    return this.store.require(agentId)
  }

  // ---- API ----

  async bootstrap(): Promise<Bootstrap> {
    return {
      agents: this.summaries(),
      rooms: this.rooms.summaries(),
      folders: this.db.listFolders(),
      settings: this.settings.get(),
      mcpServers: this.serverList(),
      env: this.envOverride ?? this.env,
      usage: this.usage.get(),
      userAvatarVersion: avatarVersion('user')
    }
  }

  async listMessages(agentId: string): Promise<ChatMessage[]> {
    if (isRoomId(String(agentId))) {
      this.rooms.require(agentId)
      return this.db.listMessages(agentId)
    }
    this.requireAgent(agentId)
    const list = this.db.listMessages(agentId)
    const live = this.engine.liveMessage(agentId)
    return live ? list.map((m) => (m.id === live.id ? { ...live } : m)) : list
  }

  /** Copies picked files into each agent's workspace (attachments/). Returns their workspace-relative paths. */
  private saveAttachments(sources: unknown, agentIds: string[]): string[] {
    const saved: string[] = []
    for (const src of Array.isArray(sources) ? sources : []) {
      if (typeof src !== 'string' || !existsSync(src)) continue
      const st = statSync(src)
      if (!st.isFile() || st.size > MAX_ATTACHMENT_BYTES) continue
      const name = `${Date.now()}-${basename(src).replace(/[^\w.\- ]+/g, '_')}`
      if (saved.includes(`attachments/${name}`)) continue
      for (const id of agentIds) copyFileSync(src, join(ensureWorkspace(id), 'attachments', name))
      saved.push(`attachments/${name}`)
    }
    return saved
  }

  async sendMessage(agentId: string, text: string, attachments?: string[]): Promise<void> {
    const body = typeof text === 'string' ? text.trim() : ''
    if (isRoomId(String(agentId))) {
      const room = this.rooms.require(agentId)
      // Every member gets its own copy, since agents can only read their own workspace.
      const files = this.saveAttachments(attachments, room.memberIds.filter((m) => this.store.get(m)))
      if (body || files.length) this.rooms.post(room.id, body, files)
      return
    }
    const agent = this.requireAgent(agentId)
    const saved = this.saveAttachments(attachments, [agent.id])
    if (!body && !saved.length) return
    const msg: ChatMessage = {
      id: randomUUID(),
      agentId,
      role: 'user',
      text: body,
      createdAt: Date.now(),
      attachments: saved.length ? saved.map((p) => p.replace(/^attachments\/\d+-/, '')) : undefined
    }
    this.db.saveMessage(msg)
    emit('message', msg)
    this.engine.enqueue(agentId, { source: 'chat', prompt: body, attachments: saved })
  }

  async stop(agentId: string): Promise<void> {
    if (isRoomId(String(agentId))) return this.rooms.stop(this.rooms.require(agentId).id)
    this.requireAgent(agentId)
    this.engine.stop(agentId)
  }

  async markRead(agentId: string): Promise<void> {
    const room = isRoomId(String(agentId))
    if (!(room ? this.rooms.get(agentId) : this.store.get(agentId))) return
    if (this.db.unread(agentId)) {
      this.db.clearUnread(agentId)
      if (room) this.emitRooms()
      else this.emitAgents()
    }
  }

  async pickAttachments(): Promise<string[]> {
    const win = BrowserWindow.getFocusedWindow()
    const opts = { properties: ['openFile' as const, 'multiSelections' as const], message: 'Choose files to send (PDFs, images, documents…)' }
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return res.canceled ? [] : res.filePaths
  }

  async createAgent(draft: AgentDraft): Promise<AgentConfig> {
    const agent = this.store.create(draft)
    ensureWorkspace(agent.id)
    this.engine.system(agent.id, `Created agent: ${agent.name}`)
    if (agent.routine?.enabled) this.engine.system(agent.id, `Created routine: ${describeCron(agent.routine.cron)}`)
    this.syncRoutines()
    this.emitAgents()
    return agent
  }

  async updateAgent(next: AgentConfig): Promise<AgentConfig> {
    const before = this.requireAgent(next?.id)
    const agent = this.store.update(next)
    const r = agent.routine
    if (JSON.stringify(before.routine) !== JSON.stringify(r)) {
      if (r?.enabled && !before.routine?.enabled) this.engine.system(agent.id, `Created routine: ${describeCron(r.cron)}`)
      else if (r?.enabled) this.engine.system(agent.id, `Routine updated: ${describeCron(r.cron)}`)
      else if (before.routine?.enabled) this.engine.system(agent.id, 'Routine turned off')
    }
    if (before.model !== agent.model) this.engine.system(agent.id, `Model changed to ${agent.model}`)
    this.syncRoutines()
    this.emitAgents()
    return agent
  }

  async deleteAgent(agentId: string): Promise<void> {
    this.requireAgent(agentId)
    this.engine.stop(agentId)
    this.store.delete(agentId)
    removeAvatar(`agent:${agentId}`)
    this.db.deleteAgent(agentId)
    this.rooms.removeMember(agentId)
    this.reminderClock.arm()
    // The workspace may hold the user's attachments: move it to the Trash (recoverable).
    const dir = workspaceOf(agentId)
    if (existsSync(dir)) await shell.trashItem(dir).catch(() => undefined)
    this.syncRoutines()
    this.emitAgents()
  }

  async resetMemory(agentId: string): Promise<void> {
    this.requireAgent(agentId)
    this.store.setSession(agentId, null)
    this.db.takeNotes(agentId)
    this.engine.system(agentId, 'Memory reset. Starting a fresh conversation.')
    this.emitAgents()
  }

  async createRoom(draft: RoomDraft): Promise<RoomConfig> {
    return this.rooms.create(draft)
  }

  async updateRoom(room: RoomConfig): Promise<RoomConfig> {
    return this.rooms.update(room)
  }

  async deleteRoom(roomId: string): Promise<void> {
    this.rooms.delete(this.rooms.require(roomId).id)
  }

  private requireFolder(id: unknown): Folder {
    const folder = this.db.listFolders().find((f) => f.id === id)
    if (!folder) throw new Error('Unknown folder')
    return folder
  }

  private folderName(name: unknown): string {
    return (typeof name === 'string' ? name.trim().slice(0, 40) : '') || 'New folder'
  }

  async createFolder(name: string): Promise<Folder> {
    const folder: Folder = { id: randomUUID().slice(0, 8), name: this.folderName(name), collapsed: false }
    this.db.saveFolder(folder)
    emit('folders', this.db.listFolders())
    return folder
  }

  async updateFolder(next: Folder): Promise<void> {
    const folder = this.requireFolder(next?.id)
    this.db.saveFolder({ ...folder, name: this.folderName(next.name), collapsed: next.collapsed === true })
    emit('folders', this.db.listFolders())
  }

  async deleteFolder(folderId: string): Promise<void> {
    this.db.deleteFolder(this.requireFolder(folderId).id)
    emit('folders', this.db.listFolders())
    this.emitAgents()
    this.emitRooms()
  }

  async moveToFolder(chatId: string, folderId: string | null): Promise<void> {
    const room = isRoomId(String(chatId))
    if (room) this.rooms.require(chatId)
    else this.requireAgent(chatId)
    this.db.setFolder(chatId, folderId === null ? null : this.requireFolder(folderId).id)
    if (room) this.emitRooms()
    else this.emitAgents()
  }

  async resolveAction(messageId: string, actionId: string, decision: 'approve' | 'reject', details?: Record<string, unknown>): Promise<void> {
    const msg = typeof messageId === 'string' ? this.db.getMessage(messageId) : null
    const action = msg?.actions?.find((a) => a.id === actionId)
    if (!msg || !action || action.status !== 'pending') return
    if (!this.store.get(msg.agentId)) return

    if (decision === 'reject') {
      action.status = 'rejected'
      this.db.saveMessage(msg)
      emit('message', msg)
      this.db.addNote(msg.agentId, `The user rejected your proposed action "${action.summary}". Don't do it.`)
      this.engine.system(msg.agentId, `Rejected: ${action.summary}`)
      this.clearApprovalNotice(messageId, msg)
      return
    }
    if (details && typeof details === 'object') action.details = details
    const run = this.engine.executeAction(msg.agentId, msg, action)
    // executeAction has marked it executing (or left it pending if usage is limited).
    this.clearApprovalNotice(messageId, msg)
    await run
  }

  async resolveHandoff(messageId: string, handoffId: string, decision: 'send' | 'dismiss'): Promise<void> {
    if (decision !== 'send' && decision !== 'dismiss') return
    const msg = typeof messageId === 'string' ? this.db.getMessage(messageId) : null
    const handoff = msg?.handoffs?.find((h) => h.id === handoffId)
    if (!msg || !handoff || handoff.status !== 'pending') return
    const from = this.store.get(msg.agentId)
    if (!from) return
    const target = this.store.get(handoff.toAgentId)

    handoff.status = decision === 'send' && target ? 'sent' : 'dismissed'
    this.db.saveMessage(msg)
    emit('message', msg)

    if (decision === 'dismiss') {
      this.db.addNote(from.id, `The user dismissed your handoff to ${handoff.toName}. Don't send it again.`)
      this.engine.system(from.id, `Dismissed handoff to ${handoff.toName}`)
    } else if (!target) {
      this.engine.system(from.id, `${handoff.toName} no longer exists, so nothing was handed off`)
    } else {
      this.db.addNote(from.id, `The user approved your handoff to ${target.name}, and it was sent.`)
      this.engine.system(from.id, `Handed off to ${target.name}`)
      this.engine.system(target.id, `Handed off from ${from.name}: ${handoff.task}`)
      this.engine.enqueue(target.id, { source: 'chat', prompt: handoffPrompt(from.name, handoff.task), attachments: [] })
    }
    this.emitAgents()
  }

  async listRoutines(): Promise<RoutineInfo[]> {
    return this.store
      .list()
      .filter((a) => a.routine)
      .map((a) => {
        const last = this.db.lastRun(a.id, 'routine')
        return {
          agentId: a.id,
          agentName: a.name,
          shape: a.shape,
          avatarVersion: avatarVersion(`agent:${a.id}`),
          color: a.color,
          routine: a.routine as NonNullable<AgentConfig['routine']>,
          nextRun: a.routine?.enabled ? this.scheduler.nextRun(a.id) : null,
          lastRun: last?.endedAt ? { at: last.endedAt, ok: last.ok === true, summary: last.summary ?? '' } : null
        }
      })
  }

  async listReminders(): Promise<Reminder[]> {
    return this.db.scheduledReminders().filter((r) => this.store.get(r.agentId))
  }

  async cancelReminder(reminderId: string): Promise<void> {
    const r = typeof reminderId === 'string' ? this.db.reminder(reminderId) : null
    if (!r || r.status !== 'scheduled') return
    this.setReminderStatus(r, 'cancelled')
    this.db.addNote(r.agentId, `The user cancelled your reminder "${r.text.slice(0, 120)}".`)
    this.engine.system(r.agentId, 'Reminder cancelled')
    this.reminderClock.arm()
    this.emitAgents()
  }

  async setRoutineEnabled(agentId: string, enabled: boolean): Promise<void> {
    const agent = this.requireAgent(agentId)
    if (!agent.routine) return
    await this.updateAgent({ ...agent, routine: { ...agent.routine, enabled: enabled === true } })
  }

  async runRoutineNow(agentId: string): Promise<void> {
    const agent = this.requireAgent(agentId)
    if (!agent.routine) return
    this.engine.system(agentId, 'Routine started manually')
    this.engine.enqueue(agentId, { source: 'routine', prompt: agent.routine.prompt, attachments: [] })
  }

  async updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
    const before = this.settings.get()
    const next = this.settings.update(patch ?? {})
    if (next.launchAtLogin !== before.launchAtLogin && app.isPackaged) {
      app.setLoginItemSettings({ openAtLogin: next.launchAtLogin })
    }
    if (next.claudePath !== before.claudePath) void this.recheckEnv()
    if (next.theme !== before.theme) {
      for (const w of BrowserWindow.getAllWindows()) w.setBackgroundColor(next.theme === 'dark' ? '#0E0E13' : '#FFFFFF')
    }
    return next
  }

  async recheckEnv(): Promise<EnvStatus> {
    this.env = await checkEnv(this.settings.get().claudePath)
    log(`env: found=${this.env.claudeFound} path=${this.env.claudePath ?? '-'} version=${this.env.version ?? '-'} loggedIn=${this.env.loggedIn} plan=${this.env.subscriptionType ?? '-'} error=${this.env.error ?? '-'}`)
    const shown = this.envOverride ?? this.env
    emit('env', shown)
    if (this.env.claudeFound && this.env.loggedIn) {
      this.engine.pump()
      void this.usage.refresh()
    }
    return shown
  }

  async usageBreakdown(): Promise<UsageBreakdown> {
    const now = Date.now()
    const info = this.usage.get()
    // Line up with the subscription's own windows when their reset time is known.
    const since = (w: UsageWindow | undefined, span: number): number => (w?.resetsAt && w.resetsAt > now ? w.resetsAt - span : now - span)
    const fiveHourSince = since(info?.fiveHour, 5 * 3_600_000)
    const sevenDaySince = since(info?.sevenDay, 7 * 86_400_000)
    return { fiveHourSince, sevenDaySince, fiveHour: this.db.usageByAgent(fiveHourSince), sevenDay: this.db.usageByAgent(sevenDaySince) }
  }

  async refreshUsage(): Promise<UsageInfo | null> {
    await this.usage.refresh()
    return this.usage.get()
  }

  async openExternal(url: string): Promise<void> {
    if (typeof url === 'string' && /^(https?:|mailto:)/i.test(url)) await shell.openExternal(url)
  }

  async setAvatar(target: string, dataUrl: string | null): Promise<number | null> {
    if (target !== 'user') this.requireAgent(/^agent:(.+)$/.exec(String(target))?.[1])
    let version: number | null = null
    if (dataUrl === null) removeAvatar(target)
    else if (typeof dataUrl === 'string') version = saveAvatar(target, dataUrl)
    if (target !== 'user') this.emitAgents()
    return version
  }

  async marketplace(refresh?: boolean): Promise<MarketplaceData> {
    return skills.marketplace(refresh === true)
  }

  async installSkill(id: string): Promise<{ ok: boolean; error?: string }> {
    try {
      await skills.installSkill(String(id))
      log(`skill installed: ${id}`)
      return { ok: true }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  }

  async uninstallSkill(name: string): Promise<{ ok: boolean; error?: string }> {
    try {
      await skills.uninstallSkill(String(name))
      return { ok: true }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  }

  async addSkillSource(input: string): Promise<{ ok: boolean; error?: string }> {
    const repo = skills.parseRepo(String(input))
    if (!repo) return { ok: false, error: 'Enter a GitHub repo like owner/repo or its github.com URL.' }
    skills.addSource(repo)
    return { ok: true }
  }

  async removeSkillSource(repo: string): Promise<void> {
    skills.removeSource(String(repo))
  }

  async gmailStatus(): Promise<GmailStatus> {
    return gmailStatus()
  }

  private connecting = false

  async connectGmail(email: string, clientId: string, clientSecret: string): Promise<{ ok: boolean; error?: string }> {
    if (this.connecting) return { ok: false, error: 'Already connecting.' }
    if ([email, clientId, clientSecret].some((v) => typeof v !== 'string')) return { ok: false, error: 'Missing details.' }
    this.connecting = true
    try {
      const res = await connectGmail({ email, clientId, clientSecret }, (p) => emit('gmailProgress', p))
      emit('mcpServers', this.serverList())
      return res
    } finally {
      this.connecting = false
    }
  }

  async calendarStatus(): Promise<GmailStatus> {
    return calendarStatus()
  }

  async connectCalendar(): Promise<{ ok: boolean; error?: string }> {
    if (this.connecting) return { ok: false, error: 'Already connecting.' }
    this.connecting = true
    try {
      const res = await connectCalendar((p) => emit('gmailProgress', p))
      emit('mcpServers', this.serverList())
      return res
    } finally {
      this.connecting = false
    }
  }
}
