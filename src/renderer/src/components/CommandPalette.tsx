// ⌘K: jump to any chat or screen, send a quick prompt, or start something new,
// without the mouse. Type to filter; ↑/↓ and Enter to pick; Esc to close.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { promptLabel } from '@shared/types'
import { api, useStore, type View } from '../lib/store'
import { searchGuide } from '../lib/guide'
import { agentPicture } from '../lib/avatars'
import { Avatar } from './Avatar'
import { GroupAvatar } from './GroupAvatar'
import { ArrowUpIcon, BookIcon, BriefcaseIcon, CheckIcon, ClockIcon, EraserIcon, GearIcon, GridIcon, PlusIcon, UsersIcon } from './icons'

interface Item {
  id: string
  label: string
  hint: string
  icon: ReactNode
  run: () => void
}

export function CommandPalette() {
  const agents = useStore((s) => s.agents)
  const rooms = useStore((s) => s.rooms)
  // The chat on screen, which "Clear this chat" applies to.
  const openChat = useStore((s) => (s.view === 'chat' ? [...s.agents, ...s.rooms].find((c) => c.id === s.selectedId) : undefined))
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const list = useRef<HTMLDivElement>(null)
  const close = (): void => useStore.setState({ paletteOpen: false })

  const items = useMemo<Item[]>(() => {
    const byId = Object.fromEntries(agents.map((a) => [a.id, a]))
    const view = (v: View) => () => useStore.getState().setView(v)
    const chats: Item[] = [...agents, ...rooms]
      .sort((a, b) => b.lastActivity - a.lastActivity)
      .map((c) => ({
        id: `chat:${c.id}`,
        label: c.name,
        hint: 'memberIds' in c ? 'Group chat' : 'Chat',
        icon:
          'memberIds' in c ? (
            <GroupAvatar members={c.memberIds.map((id) => byId[id]).filter((a): a is NonNullable<typeof a> => !!a)} size={22} backdrop="var(--elev)" />
          ) : (
            <Avatar seed={c.name} shape={c.shape} color={c.color} picture={agentPicture(c.id, c.avatarVersion)} size={22} />
          ),
        run: () => useStore.getState().select(c.id)
      }))
    const screens: Item[] = [
      { id: 'v:today', label: 'Today', hint: 'Screen', icon: <CheckIcon size={16} />, run: view('today') },
      { id: 'v:jobs', label: 'Jobs', hint: 'Screen', icon: <BriefcaseIcon size={16} />, run: view('jobs') },
      { id: 'v:routines', label: 'Routines & reminders', hint: 'Screen', icon: <ClockIcon size={16} />, run: view('routines') },
      { id: 'v:settings', label: 'Settings', hint: 'Screen', icon: <GearIcon size={16} />, run: view('settings') },
      { id: 'v:guide', label: 'Guide', hint: 'Screen', icon: <BookIcon size={16} />, run: view('guide') },
      { id: 'v:marketplace', label: 'Marketplace', hint: 'Skills', icon: <GridIcon size={16} />, run: () => useStore.getState().setMarketplaceOpen(true) },
      { id: 'a:agent', label: 'New agent…', hint: 'Action', icon: <PlusIcon size={16} />, run: () => useStore.getState().setAddOpen(true) },
      { id: 'a:room', label: 'New group chat…', hint: 'Action', icon: <UsersIcon size={16} />, run: () => useStore.getState().setRoomEditor('new') }
    ]
    if (openChat) {
      screens.push({
        id: 'a:clear',
        label: 'memberIds' in openChat ? `Clear group chat "${openChat.name}"…` : `Clear chat with ${openChat.name}…`,
        hint: 'Action',
        icon: <EraserIcon size={16} />,
        run: () => useStore.setState({ clearingId: openChat.id })
      })
    }
    const prompts: Item[] = agents.flatMap((a) =>
      a.quick_prompts.map((p, i) => ({
        id: `p:${a.id}:${i}`,
        label: promptLabel(p).text,
        hint: `Send to ${a.name}`,
        icon: <ArrowUpIcon size={16} />,
        run: () => {
          void api.sendMessage(a.id, p)
          useStore.getState().select(a.id)
        }
      }))
    )
    return [...chats, ...screens, ...prompts]
  }, [agents, rooms, openChat])

  const q = query.trim().toLowerCase()
  // While typing, how-to entries from the Guide follow the chats and screens that match.
  const howTo = useMemo<Item[]>(
    () =>
      q
        ? searchGuide(q)
            .flatMap((c) => c.features)
            .slice(0, 6)
            .map((f) => ({ id: `g:${f.id}`, label: f.title, hint: 'How to', icon: <BookIcon size={16} />, run: () => useStore.getState().openGuide(f.id) }))
        : [],
    [q]
  )
  const shown = q ? [...items.filter((i) => `${i.label} ${i.hint}`.toLowerCase().includes(q)), ...howTo] : items
  const pick = (item: Item | undefined): void => {
    if (!item) return
    close()
    item.run()
  }

  useEffect(() => setIndex(0), [query])
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-i="${index}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [index])

  return (
    <div className="fixed inset-0 z-50 flex justify-center bg-overlay/60 pt-[14vh]" onMouseDown={close}>
      <div
        role="dialog"
        aria-label="Command palette"
        className="pop h-fit w-[560px] max-w-[92vw] overflow-hidden rounded-2xl border border-line-strong bg-elev shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') close()
            else if (e.key === 'ArrowDown') {
              e.preventDefault()
              setIndex((i) => Math.min(i + 1, shown.length - 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setIndex((i) => Math.max(i - 1, 0))
            } else if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault()
              pick(shown[index])
            }
          }}
          placeholder="Go to a chat or screen, send a quick prompt, or find how to do something…"
          className="w-full border-b border-line bg-transparent px-4 py-3.5 text-[15px] text-fg outline-none placeholder:text-muted"
        />
        <div ref={list} className="max-h-[50vh] overflow-y-auto p-1.5">
          {shown.length === 0 && <div className="px-3 py-6 text-center text-[13px] text-muted">Nothing matches.</div>}
          {shown.map((item, i) => (
            <button
              key={item.id}
              data-i={i}
              type="button"
              onMouseEnter={() => setIndex(i)}
              onClick={() => pick(item)}
              className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left ${i === index ? 'bg-selected' : ''}`}
            >
              <span className="flex h-6 w-6 shrink-0 items-center justify-center text-muted">{item.icon}</span>
              <span className="min-w-0 flex-1 truncate text-[13px]">{item.label}</span>
              <span className="shrink-0 text-[11px] text-muted">{item.hint}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
