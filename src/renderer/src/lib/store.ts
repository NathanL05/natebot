import { create } from 'zustand'
import type {
  AgentSummary,
  AppSettings,
  ChatMessage,
  EnvStatus,
  McpServerInfo,
  UsageInfo
} from '@shared/types'

export type View = 'chat' | 'routines' | 'settings'

interface State {
  ready: boolean
  agents: AgentSummary[]
  settings: AppSettings | null
  mcpServers: McpServerInfo[]
  env: EnvStatus | null
  usage: UsageInfo | null
  messages: Record<string, ChatMessage[]>

  view: View
  selectedId: string | null
  search: string
  drawerOpen: boolean
  addOpen: boolean

  init(): Promise<void>
  select(agentId: string): void
  setView(view: View): void
  setSearch(search: string): void
  setDrawerOpen(open: boolean): void
  setAddOpen(open: boolean): void
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
    const { selectedId, agents, view } = get()
    const sel = agents.find((a) => a.id === selectedId)
    if (sel?.unread && view === 'chat' && document.hasFocus()) void api.markRead(sel.id)
  }

  return {
    ready: false,
    agents: [],
    settings: null,
    mcpServers: [],
    env: null,
    usage: null,
    messages: {},
    view: 'chat',
    selectedId: null,
    search: '',
    drawerOpen: false,
    addOpen: false,

    async init() {
      api.on('agents', (agents) => {
        const { selectedId } = get()
        const stillThere = selectedId !== null && agents.some((a) => a.id === selectedId)
        set({ agents })
        if (!stillThere) {
          const first = sortAgents(agents)[0]
          if (first) get().select(first.id)
          else set({ selectedId: null })
        }
        markOpenChatRead()
      })
      api.on('message', (msg) => {
        const loaded = get().messages[msg.agentId]
        if (!loaded) return
        set({ messages: { ...get().messages, [msg.agentId]: upsertMessage(loaded, msg) } })
      })
      api.on('usage', (usage) => set({ usage }))
      api.on('env', (env) => set({ env }))
      api.on('mcpServers', (mcpServers) => set({ mcpServers }))
      api.on('focusAgent', (id) => get().select(id))
      api.on('navigate', (target) => {
        if (target === 'newAgent') set({ addOpen: true })
        else set({ view: target, drawerOpen: false })
      })
      window.addEventListener('focus', markOpenChatRead)

      const boot = await api.bootstrap()
      set({
        ready: true,
        agents: boot.agents,
        settings: boot.settings,
        mcpServers: boot.mcpServers,
        env: boot.env,
        usage: boot.usage
      })
      const first = sortAgents(boot.agents)[0]
      if (first) get().select(first.id)
    },

    select(agentId) {
      set({ selectedId: agentId, view: 'chat', drawerOpen: false })
      void api.markRead(agentId)
      if (!get().messages[agentId]) {
        // Start with an empty list so live events are captured while history loads.
        set({ messages: { ...get().messages, [agentId]: [] } })
        void api.listMessages(agentId).then((history) => {
          const live = get().messages[agentId] ?? []
          const merged = live.reduce(upsertMessage, history)
          set({ messages: { ...get().messages, [agentId]: merged } })
        })
      }
    },

    setView: (view) => set({ view, drawerOpen: false }),
    setSearch: (search) => set({ search }),
    setDrawerOpen: (drawerOpen) => set({ drawerOpen }),
    setAddOpen: (addOpen) => set({ addOpen }),

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
