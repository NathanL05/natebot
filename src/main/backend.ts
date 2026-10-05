// The real NateBot backend: implements the renderer API on top of the agent
// store (YAML), the database (SQLite), the claude engine and the scheduler.
import { app, BrowserWindow, clipboard, dialog, Notification, powerMonitor, shell } from 'electron'
import { randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, statSync, unwatchFile, watchFile, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import type { NateBotApi } from '@shared/ipc'
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
  GmailStatus,
  EmailTrigger,
  Job,
  MarketplaceData,
  MessageHit,
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
import { calendarStatus, connectCalendar, connectGmail, connectGoogle, gmailStatus, gmailTokenPath, googleReady, googleStatus, googleTokenPath, isGoogle, stopGmailConnect } from './gmail'
import { AgendaReader } from './agenda'
import { configuredServersFor, ensureMcpFile, listServers } from './mcp'
import { AGENTS_DIR, DB_FILE, MCP_FILE, ROOT, TMP_DIR, WORKSPACES_DIR, workspaceOf } from './paths'
import { handoffPrompt } from './handoff'
import { APPROVAL_BUTTONS, APPROVE, approvalNotice, REJECT } from './notices'
import { readMemory, writeMemory } from './memory'
import { backupIfDue } from './backup'
import { cleanTmp } from './tmp'
import { BRIEF_ID, briefDraft, TODAY_TOKEN, todayContext } from './brief'
import { digest, inQuietHours } from './quiet'
import { parsePhoneMessage, PhoneInbox } from './phone'
import { appleConnected, connectApple, refreshAppleEntry, saveNote } from './apple'
import { dueAction, nextRepeat, ReminderClock } from './reminders'
import { deadlineReminders, JOB_HUNTER, JOB_HUNTER_ID, jobKey, parseJob } from './jobs'
import { Rooms } from './rooms'
import { EmailWatcher, triggerPrompt, type EmailHit } from './triggers'
import { dueRun, routineChanges, Scheduler, syncedCheckpoint, type Checkpoint } from './scheduler'
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
  private emailWatcher: EmailWatcher
  private agenda = new AgendaReader(googleTokenPath, appleConnected)
  private phone = new PhoneInbox((text) => this.fromPhone(text), log)
  /** Agents answering messages from your phone (how many): those replies always go to the phone. */
  private phoneWaiting = new Map<string, number>()
  private backupTimer: NodeJS.Timeout | undefined
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
  /** Opens a screen (the quiet-hours summary opens Today). */
  onShowView: (view: 'today') => void = () => undefined
  /** Notification titles held during quiet hours, summed up when they end. */
  private held: string[] = []
  private quietTimer: NodeJS.Timeout | undefined
  /** Registers the quick-capture shortcut; false if another app has it. */
  onCaptureShortcut: (accelerator: string | null) => boolean = () => true
  onHideCapture: () => void = () => undefined
  private captureOk = true

  constructor() {
    mkdirSync(ROOT, { recursive: true })
    mkdirSync(WORKSPACES_DIR, { recursive: true })
    ensureMcpFile()
    refreshAppleEntry()
    // Nothing is running yet, so any per-run MCP config left in the temp folder is from a crash.
    const cleaned = cleanTmp(TMP_DIR)
    if (cleaned) log(`startup: removed ${cleaned} leftover temp file(s)`)
    this.db = new Db(DB_FILE)
    this.db.repairInterrupted()

    this.engine = new Engine({
      store: this.store,
      db: this.db,
      usage: this.usage,
      claudePath: () => (this.env.claudeFound ? this.env.claudePath : null),
      emitMessage: (m) => emit('message', m),
      emitAgents: () => this.emitAgents(),
      lightRuns: () => this.settings.get().lightRuns,
      user: () => ({ name: this.settings.get().userName, about: this.settings.get().aboutMe }),
      onJobs: (agentId, items) => this.applyJobs(agentId, items)
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

    this.scheduler = new Scheduler((id, routineId) => this.fireRoutine(id, routineId, 'tick'))
    this.reminderClock = new ReminderClock(
      () => this.db.nextReminderAt(),
      () => this.fireReminders()
    )
    this.engine.on('remindersChanged', () => this.fireReminders())
    this.emailWatcher = new EmailWatcher({
      db: this.db,
      agents: () => this.store.list(),
      tokenPath: gmailTokenPath,
      onMatch: (agentId, trigger, hits) => this.fireTrigger(agentId, trigger, hits),
      onSignInExpired: () => this.signInExpired(),
      log
    })

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
        for (const r of a.routines) if (r.enabled) this.engine.system(a.id, `Created routine: ${describeCron(r.cron)}`)
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
    return listServers().map((s) => (isGoogle(s.name) ? { ...s, configured: googleReady(s.name) } : s))
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
    this.emailWatcher.start()
    this.backup()
    this.backupTimer = setInterval(() => this.backup(), 60 * 60_000)
    this.quietTimer = setInterval(() => this.endQuiet(), 60_000)
    this.syncPhone()
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
    this.emailWatcher.stop()
    clearInterval(this.backupTimer)
    clearInterval(this.quietTimer)
    this.phone.stop()
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
    const pending = new Map<string, number>()
    for (const m of this.db.pendingMessages()) {
      const n = (m.actions?.filter((a) => a.status === 'pending').length ?? 0) + (m.handoffs?.filter((h) => h.status === 'pending').length ?? 0)
      pending.set(m.agentId, (pending.get(m.agentId) ?? 0) + n)
    }
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
        folderId: this.db.folderOf(a.id),
        pending: pending.get(a.id) ?? 0
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

  /**
   * chatId: an agent or a group chat. `buttons` adds macOS action buttons (index of the one pressed).
   * `urgent` rings even in quiet hours (reminders you set).
   */
  private notify(
    chatId: string,
    title: string,
    body: string,
    buttons?: { labels: string[]; onAction: (index: number) => void },
    urgent = false
  ): Notification | null {
    if (!Notification.isSupported()) return null
    const quiet = this.settings.get().quietHours
    if (!urgent && quiet && inQuietHours(new Date(), quiet.start, quiet.end)) {
      this.held.push(title)
      return null
    }
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
    this.push(name ? `${name} · ${title}` : title, body)
    return n
  }

  private syncPhone(): void {
    const { phoneInbox, pushTopic } = this.settings.get()
    this.phone.listen(phoneInbox && pushTopic ? `${pushTopic}-in` : null)
  }

  /** A message from your phone: to the @named agent, or the one you used last. */
  private fromPhone(raw: string): void {
    const { agent, text } = parsePhoneMessage(raw)
    if (!text) return
    const agents = this.summaries()
    const key = agent?.replace(/[^a-z0-9]/g, '') ?? ''
    const target = agent
      ? agents.find((a) => a.id === agent || a.name.toLowerCase().replace(/[^a-z0-9]/g, '').startsWith(key))
      : [...agents].sort((a, b) => b.lastActivity - a.lastActivity)[0]
    if (!target) {
      void this.push('NateBot', agent ? `No agent called "${agent}".` : 'Add an agent in NateBot first.')
      return
    }
    log(`phone: message for ${target.id}`)
    this.engine.system(target.id, 'Message from your phone')
    this.phoneWaiting.set(target.id, (this.phoneWaiting.get(target.id) ?? 0) + 1)
    void this.sendMessage(target.id, text)
  }

  /** Whether this chat reply answers a message from your phone (one reply per message sent). */
  private fromPhoneReply(agentId: string): boolean {
    const n = this.phoneWaiting.get(agentId) ?? 0
    if (!n) return false
    if (n > 1) this.phoneWaiting.set(agentId, n - 1)
    else this.phoneWaiting.delete(agentId)
    return true
  }

  /** When quiet hours are over, one notification sums up what was held. */
  private endQuiet(): void {
    if (!this.held.length) return
    const quiet = this.settings.get().quietHours
    if (quiet && inQuietHours(new Date(), quiet.start, quiet.end)) return
    const body = digest(this.held)
    this.held = []
    if (!Notification.isSupported()) return
    const n = new Notification({ title: 'While you were away', body, silent: false })
    n.on('click', () => this.onShowView('today'))
    n.show()
    void this.push('While you were away', body)
  }

  /** Copies a notification to your phone through ntfy (Settings → General), if set up. Text only when you allow it. */
  private push(title: string, body: string): Promise<{ ok: boolean; error?: string }> {
    const { pushTopic, pushDetails } = this.settings.get()
    if (!pushTopic) return Promise.resolve({ ok: false, error: 'No topic set.' })
    // Header values must be plain ASCII; ntfy shows a fallback title otherwise.
    const ascii = title.replace(/[^\x20-\x7E]/g, '').trim() || 'NateBot'
    return fetch(`https://ntfy.sh/${encodeURIComponent(pushTopic)}`, {
      method: 'POST',
      headers: { Title: ascii, Tags: 'robot' },
      signal: AbortSignal.timeout(15_000),
      body: pushDetails ? body.slice(0, 1000) : 'Open NateBot to see it.'
    })
      .then((r) => (r.ok ? { ok: true } : { ok: false, error: `ntfy returned ${r.status}` }))
      .catch((e: Error) => {
        log(`push failed: ${e.message}`)
        return { ok: false, error: e.message }
      })
  }

  private signInWarnedAt = 0

  /** Gmail's sign-in expired: say so once a day, before routines start failing on it. */
  private signInExpired(): void {
    if (Date.now() - this.signInWarnedAt < 86_400_000) return
    this.signInWarnedAt = Date.now()
    const agent = this.store.list().find((a) => a.mcp_servers.includes('gmail'))
    this.notify(agent?.id ?? '', 'Gmail needs reconnecting', 'The Gmail sign-in expired. Open Settings → Connected tools → Connect Gmail.')
    if (agent) this.engine.system(agent.id, "Gmail's sign-in expired. Reconnect it in Settings → Connected tools (publishing your Google app stops the weekly expiry).")
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
    // You asked from your phone: answer there, even if the Mac is in front or it's quiet hours.
    if (r.source === 'chat' && this.fromPhoneReply(r.agentId) && !r.needsApproval) {
      // The whole reply, not just its first line: on a phone this is the conversation.
      const text = (this.db.getMessage(r.messageId)?.text || r.summary).replace(/[*_`#>]/g, '').trim()
      this.notify(r.agentId, r.ok ? 'Replied' : 'Failed', text, undefined, true)
      return
    }
    if (r.needsApproval) this.notifyApproval(r)
    else if (r.handoffTo) this.notify(r.agentId, 'Suggests a handoff', `Pass a task to ${r.handoffTo}? Open NateBot to review and confirm.`)
    // A routine or reminder with nothing to report stays in the chat, without a notification.
    else if (r.quiet) log(`run: agent=${r.agentId} had nothing to report, no notification`)
    else if (r.source === 'routine') this.notify(r.agentId, r.ok ? 'Routine finished' : 'Routine failed', r.summary)
    else if (r.source === 'reminder') this.notify(r.agentId, 'Reminder', r.summary)
    else if (r.source === 'trigger') this.notify(r.agentId, 'New email', r.summary)
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
      const cps = this.db.routineCheckpoints(a.id)
      const next: Record<string, Checkpoint> = {}
      for (const r of a.routines) {
        const cp = syncedCheckpoint(r, cps[r.id] ?? null, now)
        if (cp) next[r.id] = cp
      }
      if (JSON.stringify(next) !== JSON.stringify(cps)) this.db.setRoutineCheckpoints(a.id, next)
    }
    this.scheduler.sync(agents)
  }

  private catchUpRoutines(): void {
    // A run that can't start would still use up the missed time: wait for a working claude.
    const env = this.envOverride ?? this.env
    if (!env.claudeFound || !env.loggedIn) return
    for (const a of this.store.list()) for (const r of a.routines) if (r.enabled) this.fireRoutine(a.id, r.id, 'catch-up')
  }

  private fireRoutine(agentId: string, routineId: string, trigger: 'tick' | 'catch-up'): void {
    const agent = this.store.get(agentId)
    const routine = agent?.routines.find((r) => r.id === routineId)
    if (!agent || !routine?.enabled) return
    const now = Date.now()
    const cps = this.db.routineCheckpoints(agentId)
    const due = dueRun(routine.cron, cps[routineId] ?? null, now, trigger)
    if (due === null) return
    // From here this scheduled time counts as dealt with, whether it runs or is skipped.
    this.db.setRoutineCheckpoints(agentId, { ...cps, [routineId]: { cron: routine.cron, at: now } })
    const late = now - due > LATE_AFTER_MS
    if (late) log(`routine: agent=${agentId} routine=${routineId} catching up on ${new Date(due).toISOString()} (${trigger})`)
    const time = clock(now)
    // With several routines, say which one.
    const which = agent.routines.length > 1 ? ` (${describeCron(routine.cron)})` : ''
    const dueText = late ? ` (it was due at ${new Date(due).toDateString() === new Date(now).toDateString() ? '' : 'yesterday at '}${clock(due)})` : ''
    // Don't spend usage on a routine whose tools aren't set up (e.g. Gmail not connected).
    const ready = configuredServersFor(agent).filter((n) => googleReady(n))
    const missing = agent.mcp_servers.filter((n) => !ready.includes(n))
    if (missing.length) {
      this.engine.system(agentId, `Routine${which} skipped at ${time}${dueText}: ${missing.join(', ')} isn't set up yet`)
      this.emitAgents()
      return
    }
    const paused = this.weekPaused()
    if (paused) {
      this.engine.system(agentId, `Routine${which} skipped at ${time}${dueText}: ${paused}`)
      this.emitAgents()
      return
    }
    const wait = this.usage.waitMs()
    if (wait > 0) {
      this.engine.system(agentId, `Routine${which} skipped at ${time}${dueText}: usage limit reached (resets at ${clock(now + wait)})`)
      this.emitAgents()
      return
    }
    this.engine.system(agentId, `Routine${which} ran at ${time}${dueText}`)
    void this.expandPrompt(routine.prompt).then((prompt) =>
      this.engine.enqueue(agentId, { source: 'routine', routineId, prompt, attachments: [], ...(late ? { dueAt: due } : {}) })
    )
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

  /** Moves a repeating reminder to its next time, here and on the card that set it. */
  private moveReminder(r: Reminder, at: number): void {
    this.db.saveReminder({ ...r, at })
    const msg = r.messageId ? this.db.getMessage(r.messageId) : null
    const copy = msg?.reminders?.find((x) => x.id === r.id)
    if (msg && copy) {
      copy.at = at
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
      // A repeating reminder moves on to its next time instead of finishing.
      if (r.repeat) this.moveReminder(r, nextRepeat(r.at, r.repeat, now))
      else this.setReminderStatus(r, 'done')
      log(`reminder: agent=${r.agentId} kind=${r.kind} late=${now - r.at > LATE_AFTER_MS}`)
      const paused = r.kind === 'task' ? this.weekPaused() : null
      if (paused) {
        // Still remind, just without spending usage on the task.
        this.engine.say(r.agentId, `⏰ ${r.text}`)
        this.engine.system(r.agentId, `The agent didn't work on this reminder: ${paused}`)
        this.notify(r.agentId, 'Reminder', r.text, undefined, true)
      } else if (r.kind === 'message') {
        this.engine.say(r.agentId, `⏰ ${r.text}`)
        this.notify(r.agentId, 'Reminder', r.text, undefined, true)
      } else {
        this.engine.system(r.agentId, `Reminder ran at ${clock(now)}${now - r.at > LATE_AFTER_MS ? ` (it was due at ${due})` : ''}`)
        this.engine.enqueue(r.agentId, { source: 'reminder', prompt: r.text, attachments: [], dueAt: r.at })
      }
    }
    this.reminderClock.arm()
    this.emitAgents()
  }

  /** Adds or updates tracker entries from an agent's ```jobs block. Returns the chat line. */
  private applyJobs(agentId: string, items: Record<string, unknown>[]): string | null {
    let added = 0
    let updated = 0
    const now = Date.now()
    for (const raw of items.slice(0, 20)) {
      const p = parseJob(raw)
      if (!p) continue
      const key = jobKey(p.company, p.role)
      const old = this.db.jobByKey(key)
      const job: Job = old
        ? { ...old, ...p, notes: p.notes ?? old.notes, updatedAt: now }
        : { id: randomUUID(), status: 'saved', deadline: null, link: null, notes: '', agentId, createdAt: now, updatedAt: now, ...p }
      this.db.saveJob(job, key)
      this.syncJobReminders(job)
      if (old) updated++
      else added++
    }
    if (!added && !updated) return null
    this.emitAgents()
    return `Job tracker: ${[added && `${added} added`, updated && `${updated} updated`].filter(Boolean).join(', ')}`
  }

  /** Replaces a job's deadline reminders (free message reminders in the agent's chat). */
  private syncJobReminders(job: Job): void {
    for (const id of this.db.jobReminders(job.id)) if (this.db.reminder(id)?.status === 'scheduled') this.db.setReminderStatus(id, 'cancelled')
    const agentId = this.store.get(job.agentId) ? job.agentId : null
    const ids: string[] = []
    if (agentId) {
      for (const r of deadlineReminders(job, Date.now())) {
        const id = randomUUID()
        this.db.saveReminder({ id, agentId, messageId: '', at: r.at, kind: 'message', text: r.text, status: 'scheduled' })
        ids.push(id)
      }
    }
    this.db.setJobReminders(job.id, ids)
    this.reminderClock.arm()
  }

  /** New email matched one of an agent's triggers: run it (unless the week's usage says not to). */
  private fireTrigger(agentId: string, trigger: EmailTrigger, hits: EmailHit[]): void {
    const what = hits.length === 1 ? `“${hits[0]?.subject || '(no subject)'}” from ${hits[0]?.from}` : `${hits.length} new emails`
    log(`email trigger: agent=${agentId} trigger=${trigger.id} matches=${hits.length}`)
    const paused = this.weekPaused()
    if (paused) {
      this.engine.system(agentId, `Email trigger matched ${what}, but the agent didn't run: ${paused}`)
      this.notify(agentId, 'New email', what)
      this.emitAgents()
      return
    }
    this.engine.system(agentId, `Email trigger: ${what} (search: ${trigger.query})`)
    this.engine.enqueue(agentId, { source: 'trigger', prompt: triggerPrompt(trigger, hits), attachments: [] })
  }

  /** Today's backup of ~/NateBot (checked hourly; does nothing once it exists). */
  private backup(): void {
    try {
      const made = backupIfDue(this.db.raw)
      if (made) log(`backup: ${made}`)
    } catch (e) {
      log(`backup failed: ${(e as Error).message}`)
    }
  }

  /** Fills {{today}} in a routine prompt with today's calendar, tasks, reminders and deadlines. */
  private async expandPrompt(prompt: string): Promise<string> {
    if (!prompt.includes(TODAY_TOKEN)) return prompt
    const agenda = await this.agenda.today(true).catch(() => null)
    const context = agenda
      ? todayContext({
          agenda,
          reminders: this.db.scheduledReminders(),
          jobs: this.db.listJobs(),
          pending: this.summaries().reduce((n, a) => n + a.pending, 0),
          now: Date.now()
        })
      : '[Today, from NateBot]\n(could not be read)'
    return prompt.split(TODAY_TOKEN).join(context)
  }

  /** Why unattended runs are paused this week (Settings → Usage), or null if they aren't. */
  private weekPaused(): string | null {
    const at = this.settings.get().pauseRoutinesAt
    const used = this.usage.get()?.sevenDay.utilization ?? null
    if (at === null || used === null || used < at) return null
    return `this week's usage is at ${Math.round(used * 100)}%, and routines pause at ${Math.round(at * 100)}% (Settings → Usage)`
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

  async pendingMessages(): Promise<ChatMessage[]> {
    return this.db.pendingMessages().filter((m) => this.store.get(m.agentId))
  }

  async todayAgenda(refresh?: boolean): Promise<Agenda> {
    return this.agenda.today(refresh === true)
  }

  async saveText(suggestedName: string, text: string): Promise<{ ok: boolean; path?: string }> {
    const name = (typeof suggestedName === 'string' ? suggestedName : 'Reply').replace(/[/\\:*?"<>|]+/g, ' ').trim().slice(0, 80) || 'Reply'
    const win = BrowserWindow.getFocusedWindow()
    const opts = { defaultPath: join(homedir(), 'Documents', `${name}.md`), filters: [{ name: 'Markdown', extensions: ['md'] }, { name: 'Text', extensions: ['txt'] }] }
    const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
    if (res.canceled || !res.filePath) return { ok: false }
    writeFileSync(res.filePath, typeof text === 'string' ? text : '')
    return { ok: true, path: res.filePath }
  }

  async saveToNotes(title: string, text: string): Promise<{ ok: boolean; error?: string }> {
    if (!appleConnected()) return { ok: false, error: 'Connect Apple Reminders & Notes in Settings first.' }
    return saveNote(String(title || 'From NateBot'), String(text ?? ''))
  }

  async setPinned(messageId: string, pinned: boolean): Promise<void> {
    const msg = typeof messageId === 'string' ? this.db.getMessage(messageId) : null
    if (!msg || msg.streaming) return
    if (pinned === true) msg.pinned = true
    else delete msg.pinned
    this.db.saveMessage(msg)
    emit('message', msg)
  }

  async pinnedMessages(chatId: string): Promise<ChatMessage[]> {
    return this.db.pinnedMessages(String(chatId))
  }

  async listJobs(): Promise<Job[]> {
    return this.db.listJobs()
  }

  async updateJob(next: Job): Promise<void> {
    const old = this.db.job(String(next?.id))
    if (!old) return
    const p = parseJob({ ...old, ...next })
    if (!p) return
    const job: Job = { ...old, ...p, status: p.status ?? old.status, deadline: typeof next.deadline === 'string' ? (p.deadline ?? null) : null, link: p.link ?? null, notes: p.notes ?? '', updatedAt: Date.now() }
    this.db.saveJob(job, jobKey(job.company, job.role))
    this.syncJobReminders(job)
    this.emitAgents()
  }

  async deleteJob(jobId: string): Promise<void> {
    const job = this.db.job(String(jobId))
    if (!job) return
    this.syncJobReminders({ ...job, status: 'rejected' })
    this.db.deleteJob(job.id)
    this.emitAgents()
  }

  async createMorningBrief(): Promise<string> {
    const existing = this.store.get(BRIEF_ID)
    if (existing) return existing.id
    // Only the tools that are actually connected (Calendar, Tasks and Reminders come in through {{today}}).
    const servers = ['gmail'].filter((s) => googleReady(s) && configuredServersFor({ mcp_servers: [s] } as AgentConfig).length)
    const agent = await this.createAgent({ ...briefDraft(servers), read_folders: this.sharedFolders() })
    return agent.id
  }

  async createJobHunter(): Promise<string> {
    const existing = this.store.get(JOB_HUNTER_ID)
    if (existing) return existing.id
    const agent = await this.createAgent({ ...JOB_HUNTER, read_folders: this.sharedFolders() })
    return agent.id
  }

  async searchMessages(query: string): Promise<MessageHit[]> {
    const q = typeof query === 'string' ? query.trim() : ''
    if (q.length < 2) return []
    return this.db.searchMessages(q.slice(0, 200)).filter((h) => (isRoomId(h.chatId) ? this.rooms.get(h.chatId) : this.store.get(h.chatId)))
  }

  async pickFolder(): Promise<string | null> {
    const win = BrowserWindow.getFocusedWindow()
    const opts = { properties: ['openDirectory' as const], message: 'Choose a folder this agent may read (it can never change it)' }
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return res.canceled ? null : (res.filePaths[0] ?? null)
  }

  /** Folders any agent can already read: new built-in agents (Job Hunter, Morning Brief) get them too. */
  private sharedFolders(): string[] {
    return [...new Set(this.store.list().flatMap((a) => a.read_folders))]
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
    for (const r of agent.routines) if (r.enabled) this.engine.system(agent.id, `Created routine: ${describeCron(r.cron)}`)
    this.syncRoutines()
    this.emitAgents()
    return agent
  }

  async updateAgent(next: AgentConfig): Promise<AgentConfig> {
    const before = this.requireAgent(next?.id)
    const agent = this.store.update(next)
    for (const line of routineChanges(before.routines, agent.routines)) this.engine.system(agent.id, line)
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
    this.engine.system(agentId, 'Memory reset. Starting a fresh conversation (lasting notes are kept).')
    this.emitAgents()
  }

  async getMemory(agentId: string): Promise<string> {
    this.requireAgent(agentId)
    return readMemory(agentId)
  }

  async setMemory(agentId: string, text: string): Promise<void> {
    const agent = this.requireAgent(agentId)
    ensureWorkspace(agent.id)
    writeMemory(agent.id, typeof text === 'string' ? text : '')
    // A running session saw the old notes: point it at the new ones.
    if (agent.session_id) this.db.addNote(agent.id, 'The user edited your memory.md. Read it again before relying on what it said.')
    this.engine.system(agent.id, 'Lasting notes updated')
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
      this.emitAgents()
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
    return this.store.list().flatMap((a) =>
      a.routines.map((routine) => {
        const last = this.db.lastRun(a.id, 'routine', routine.id)
        return {
          agentId: a.id,
          agentName: a.name,
          shape: a.shape,
          avatarVersion: avatarVersion(`agent:${a.id}`),
          color: a.color,
          routine,
          nextRun: routine.enabled ? this.scheduler.nextRun(a.id, routine.id) : null,
          lastRun: last?.endedAt ? { at: last.endedAt, ok: last.ok === true, summary: last.summary ?? '' } : null
        }
      })
    )
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

  async setRoutineEnabled(agentId: string, routineId: string, enabled: boolean): Promise<void> {
    const agent = this.requireAgent(agentId)
    if (!agent.routines.some((r) => r.id === routineId)) return
    const routines = agent.routines.map((r) => (r.id === routineId ? { ...r, enabled: enabled === true } : r))
    await this.updateAgent({ ...agent, routines })
  }

  async runRoutineNow(agentId: string, routineId: string): Promise<void> {
    const agent = this.requireAgent(agentId)
    const routine = agent.routines.find((r) => r.id === routineId)
    if (!routine) return
    this.engine.system(agentId, 'Routine started manually')
    const prompt = await this.expandPrompt(routine.prompt)
    this.engine.enqueue(agentId, { source: 'routine', routineId, prompt, attachments: [] })
  }

  async updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
    const before = this.settings.get()
    const next = this.settings.update(patch ?? {})
    if (next.launchAtLogin !== before.launchAtLogin && app.isPackaged) {
      app.setLoginItemSettings({ openAtLogin: next.launchAtLogin })
    }
    if (next.claudePath !== before.claudePath) void this.recheckEnv()
    if (next.quickCapture !== before.quickCapture) this.applyCaptureShortcut()
    if (next.phoneInbox !== before.phoneInbox || next.pushTopic !== before.pushTopic) this.syncPhone()
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

  /** Registers the quick-capture shortcut from the settings (at startup and when it changes). */
  applyCaptureShortcut(): void {
    const accel = this.settings.get().quickCapture
    this.captureOk = this.onCaptureShortcut(accel)
    if (!this.captureOk) log(`quick capture: couldn't register ${accel}`)
  }

  async readClipboard(): Promise<{ text: string | null; imagePath: string | null }> {
    const text = (await clipboard.readText().catch(() => '')).trim()
    let imagePath: string | null = null
    try {
      // The async clipboard API: a copied screenshot shows up as an image/png item.
      const item = (await clipboard.read()).find((i) => i.types.includes('image/png'))
      const blob = item ? ((await item.getType('image/png')) as Blob) : null
      if (blob && blob.size > 0 && blob.size < 20 * 1024 * 1024) {
        mkdirSync(TMP_DIR, { recursive: true, mode: 0o700 })
        imagePath = join(TMP_DIR, `clipboard-${Date.now()}.png`)
        writeFileSync(imagePath, Buffer.from(await blob.arrayBuffer()))
      }
    } catch {
      // No image, or the clipboard couldn't be read: text only.
    }
    return { text: text ? text.slice(0, 8000) : null, imagePath }
  }

  async hideCapture(): Promise<void> {
    this.onHideCapture()
  }

  async captureShortcutOk(): Promise<boolean> {
    return this.captureOk
  }

  async testPush(): Promise<{ ok: boolean; error?: string }> {
    return this.push('NateBot', 'Phone notifications work.')
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

  async connectApple(): Promise<{ ok: boolean; error?: string }> {
    const res = await connectApple()
    log(`apple: connect ok=${res.ok}`)
    emit('mcpServers', this.serverList())
    return res
  }

  async googleStatus(server: string): Promise<GmailStatus> {
    return googleStatus(String(server))
  }

  async connectGoogle(server: string): Promise<{ ok: boolean; error?: string }> {
    if (this.connecting) return { ok: false, error: 'Already connecting.' }
    this.connecting = true
    try {
      const res = await connectGoogle(String(server), (p) => emit('gmailProgress', p))
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
