import { create } from 'zustand'
import type {
  AgentSummary,
  AppSettings,
  ChatMessage,
  EnvStatus,
  Folder,
  McpServerInfo,
  RoomSummary,
  UsageInfo
} from '@shared/types'

export type View = 'chat' | 'today' | 'routines' | 'settings'

interface State {
  ready: boolean
  agents: AgentSummary[]
  rooms: RoomSummary[]
  folders: Folder[]
  settings: AppSettings | null
  mcpServers: McpServerInfo[]
  env: EnvStatus | null
  usage: UsageInfo | null
  userAvatarVersion: number | null
  messages: Record<string, ChatMessage[]>

  view: View
  selectedId: string | null
  search: string
  /** A message to scroll to and highlight once its chat is showing (from search). */
  focusMessageId: string | null
  drawerOpen: boolean
  addOpen: boolean
  /** Folder a new agent goes into (from a folder's + button). */
  addFolderId: string | null
  gmailOpen: boolean
  calendarOpen: boolean
  marketplaceOpen: boolean
  /** Group chat editor: 'new', a room id to edit, or null when closed. */
  roomEditor: string | null
  /** Sidebar folder whose name is being edited. */
  renamingFolderId: string | null

  init(): Promise<void>
  /** Opens an agent's chat or a group chat. */
  select(chatId: string): void
  /** Opens a chat at one message. */
  openMessage(chatId: string, messageId: string): void
  setView(view: View): void
  setSearch(search: string): void
  setDrawerOpen(open: boolean): void
  setAddOpen(open: boolean, folderId?: string | null): void
  setGmailOpen(open: boolean): void
  setCalendarOpen(open: boolean): void
  setMarketplaceOpen(open: boolean): void
  setRoomEditor(target: string | null): void
  patchSettings(patch: Partial<AppSettings>): Promise<void>
}

export const api = window.natebot

function upsertMessage(list: ChatMessage[], msg: ChatMessage): ChatMessage[] {
  const i = list.findIndex((m) => m.id === msg.id)
  if (i === -1) return [...list, msg]
  const next = list.slice()
  next[i] = msg
  return next
}

export function sortAgents(agents: AgentSummary[]): AgentSummary[] {
  return [...agents].sort((a, b) => b.lastActivity - a.lastActivity)
}

export const useStore = create<State>((set, get) => {
  /** Keep the open chat marked read while the user is looking at it. */
  const markOpenChatRead = (): void => {
    const { selectedId, agents, rooms, view } = get()
    const sel = agents.find((a) => a.id === selectedId) ?? rooms.find((r) => r.id === selectedId)
    if (sel?.unread && view === 'chat' && document.hasFocus()) void api.markRead(sel.id)
  }

  /** After the open chat disappears, fall back to the most recent agent. */
  const keepSelection = (): void => {
    const { selectedId, agents, rooms } = get()
    if (selectedId !== null && (agents.some((a) => a.id === selectedId) || rooms.some((r) => r.id === selectedId))) return
    const first = sortAgents(agents)[0]
    if (first) get().select(first.id)
    else set({ selectedId: null })
  }

  return {
    ready: false,
    agents: [],
    rooms: [],
    folders: [],
    settings: null,
    mcpServers: [],
    env: null,
    usage: null,
    userAvatarVersion: null,
    messages: {},
    view: 'chat',
    selectedId: null,
    search: '',
    focusMessageId: null,
    drawerOpen: false,
    addOpen: false,
    addFolderId: null,
    gmailOpen: false,
    calendarOpen: false,
    marketplaceOpen: false,
    roomEditor: null,
    renamingFolderId: null,

    async init() {
      api.on('agents', (agents) => {
        set({ agents })
        keepSelection()
        markOpenChatRead()
      })
      api.on('rooms', (rooms) => {
        set({ rooms })
        keepSelection()
        markOpenChatRead()
      })
      api.on('message', (msg) => {
        const loaded = get().messages[msg.agentId]
        if (!loaded) return
        set({ messages: { ...get().messages, [msg.agentId]: upsertMessage(loaded, msg) } })
      })
      api.on('folders', (folders) => set({ folders }))
      api.on('usage', (usage) => set({ usage }))
      api.on('env', (env) => set({ env }))
      api.on('mcpServers', (mcpServers) => set({ mcpServers }))
      api.on('focusAgent', (id) => get().select(id))
      api.on('navigate', (target) => {
        if (target === 'newAgent') set({ addOpen: true, addFolderId: null })
        else if (target === 'newRoom') set({ roomEditor: 'new' })
        else set({ view: target, drawerOpen: false })
      })
      window.addEventListener('focus', markOpenChatRead)

      const boot = await api.bootstrap()
      set({
        ready: true,
        agents: boot.agents,
        rooms: boot.rooms,
        folders: boot.folders,
        settings: boot.settings,
        mcpServers: boot.mcpServers,
        env: boot.env,
        usage: boot.usage,
        userAvatarVersion: boot.userAvatarVersion
      })
      const first = sortAgents(boot.agents)[0]
      if (first) get().select(first.id)
    },

    select(chatId) {
      set({ selectedId: chatId, view: 'chat', drawerOpen: false, focusMessageId: null })
      void api.markRead(chatId)
      if (!get().messages[chatId]) {
        // Start with an empty list so live events are captured while history loads.
        set({ messages: { ...get().messages, [chatId]: [] } })
        void api.listMessages(chatId).then((history) => {
          const live = get().messages[chatId] ?? []
          const merged = live.reduce(upsertMessage, history)
          set({ messages: { ...get().messages, [chatId]: merged } })
        })
      }
    },

    openMessage(chatId, messageId) {
      get().select(chatId)
      set({ focusMessageId: messageId })
    },

    setView: (view) => set({ view, drawerOpen: false }),
    setSearch: (search) => set({ search }),
    setDrawerOpen: (drawerOpen) => set({ drawerOpen }),
    setAddOpen: (addOpen, folderId = null) => set({ addOpen, addFolderId: addOpen ? folderId : null }),
    setGmailOpen: (gmailOpen) => set({ gmailOpen }),
    setCalendarOpen: (calendarOpen) => set({ calendarOpen }),
    setMarketplaceOpen: (marketplaceOpen) => set({ marketplaceOpen }),
    setRoomEditor: (roomEditor) => set({ roomEditor }),

    async patchSettings(patch) {
      const current = get().settings
      if (current) set({ settings: { ...current, ...patch } })
      const settings = await api.updateSettings(patch)
      set({ settings })
    }
  }
})

export function useSelectedAgent(): AgentSummary | undefined {
  return useStore((s) => s.agents.find((a) => a.id === s.selectedId))
}

export function useSelectedRoom(): RoomSummary | undefined {
  return useStore((s) => s.rooms.find((r) => r.id === s.selectedId))
}
