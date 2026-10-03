// The sidebar's chats (agents and group chats), grouped into folders like
// Claude's projects. Chats move between folders by drag and drop or from the
// right-click menu. Searching shows one flat list.
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent, type ReactNode } from 'react'
import type { AgentSummary, Folder, MessageHit, RoomSummary } from '@shared/types'
import { api, useStore } from '../lib/store'
import { listTime } from '../lib/format'
import { agentPicture } from '../lib/avatars'
import { Avatar } from './Avatar'
import { GroupAvatar } from './GroupAvatar'
import { CheckIcon, ChevronIcon, MoreIcon, PlusIcon, UsersIcon } from './icons'

type Chat = { kind: 'agent'; chat: AgentSummary } | { kind: 'room'; chat: RoomSummary }

const DRAG_TYPE = 'application/x-natebot-chat'
/** Drop-target key for "No folder". */
const NO_FOLDER = ''

/** Creates a folder and starts renaming it; optionally moves a chat into it. */
export async function newFolder(chatId?: string): Promise<void> {
  const folder = await api.createFolder('New folder')
  if (chatId) await api.moveToFolder(chatId, folder.id)
  useStore.setState({ renamingFolderId: folder.id })
}

// ---- context menu ----

type MenuItem = { label: string; onClick?: () => void; checked?: boolean; danger?: boolean; heading?: boolean } | 'separator'

function Menu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const outside = (e: globalThis.MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', outside, true)
    window.addEventListener('keydown', key)
    window.addEventListener('blur', onClose)
    return () => {
      window.removeEventListener('mousedown', outside, true)
      window.removeEventListener('keydown', key)
      window.removeEventListener('blur', onClose)
    }
  }, [onClose])

  return (
    <div
      ref={ref}
      role="menu"
      className="pop fixed z-50 min-w-[190px] rounded-xl border border-line-strong bg-elev p-1 shadow-2xl"
      style={{ left: Math.min(x, window.innerWidth - 210), top: Math.min(y, window.innerHeight - items.length * 32 - 16) }}
    >
      {items.map((item, i) =>
        item === 'separator' ? (
          <div key={i} className="my-1 h-px bg-line" />
        ) : item.heading ? (
          <div key={i} className="px-2.5 pt-1.5 pb-1 text-[11px] font-medium tracking-wide text-muted uppercase">
            {item.label}
          </div>
        ) : (
          <button
            key={i}
            type="button"
            role="menuitem"
            onClick={() => {
              onClose()
              item.onClick?.()
            }}
            className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] transition hover:bg-hover ${
              item.danger ? 'text-danger' : 'text-fg'
            }`}
          >
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            {item.checked && <CheckIcon size={13} className="text-accent" />}
          </button>
        )
      )}
    </div>
  )
}

// ---- rows ----

function ChatRow({
  id,
  name,
  avatar,
  preview,
  time,
  unread,
  active,
  onMenu
}: {
  id: string
  name: string
  avatar: ReactNode
  preview: string
  time: string
  unread: number
  active: boolean
  onMenu: (e: MouseEvent) => void
}) {
  return (
    <button
      type="button"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_TYPE, id)
        e.dataTransfer.effectAllowed = 'move'
      }}
      onClick={() => useStore.getState().select(id)}
      onContextMenu={onMenu}
      className={`flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition ${
        active ? 'bg-selected' : 'hover:bg-hover'
      }`}
    >
      <div className="relative">{avatar}</div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className={`truncate text-[14px] ${unread ? 'font-semibold' : 'font-medium'}`}>{name}</span>
          <span className="ml-auto shrink-0 text-[12px] text-muted">{time}</span>
        </div>
        <div className="mt-0.5 flex items-center gap-2">
          <span className={`line-clamp-2 text-[13px] leading-snug ${unread ? 'text-fg' : 'text-muted'}`}>{preview}</span>
          {unread > 0 && <span className="ml-auto h-2.5 w-2.5 shrink-0 rounded-full bg-accent" aria-label={`${unread} unread`} />}
        </div>
      </div>
    </button>
  )
}

// ---- folder header ----

function RenameField({ folder }: { folder: Folder }) {
  const [draft, setDraft] = useState(folder.name)
  const done = (save: boolean): void => {
    useStore.setState({ renamingFolderId: null })
    const name = draft.trim()
    if (save && name && name !== folder.name) void api.updateFolder({ ...folder, name })
  }
  return (
    <input
      autoFocus
      value={draft}
      maxLength={40}
      aria-label="Folder name"
      onFocus={(e) => e.target.select()}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') done(true)
        if (e.key === 'Escape') done(false)
      }}
      onBlur={() => done(true)}
      className="h-6 min-w-0 flex-1 rounded-md border border-accent bg-field px-1.5 text-[13px] font-medium text-fg outline-none"
    />
  )
}

function SectionHeader({
  label,
  folder,
  unread,
  onAdd,
  onMenu
}: {
  label: ReactNode
  folder?: Folder
  unread?: boolean
  onAdd: () => void
  onMenu?: (e: MouseEvent) => void
}) {
  const renaming = useStore((s) => !!folder && s.renamingFolderId === folder.id)
  const toggle = (): void => {
    if (folder) void api.updateFolder({ ...folder, collapsed: !folder.collapsed })
  }
  return (
    <div className="group flex h-8 items-center gap-1 pr-1 pl-2.5" onContextMenu={onMenu}>
      {renaming && folder ? (
        <RenameField key={folder.id} folder={folder} />
      ) : (
        <button
          type="button"
          onClick={toggle}
          disabled={!folder}
          aria-expanded={folder ? !folder.collapsed : undefined}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-[13px] font-medium text-muted transition enabled:hover:text-fg"
        >
          {label}
          {folder && <ChevronIcon size={12} className={`shrink-0 transition-transform ${folder.collapsed ? '' : 'rotate-90'}`} />}
          {unread && <span className="h-2 w-2 shrink-0 rounded-full bg-accent" aria-label="Unread messages" />}
        </button>
      )}
      {onMenu && (
        <button
          type="button"
          aria-label="Folder options"
          title="Folder options"
          onClick={onMenu}
          className="flex h-6 w-6 items-center justify-center rounded-md text-muted opacity-0 transition group-hover:opacity-100 hover:bg-hover hover:text-fg focus-visible:opacity-100"
        >
          <MoreIcon size={15} />
        </button>
      )}
      <button
        type="button"
        aria-label="New agent here"
        title="New agent here"
        onClick={onAdd}
        className="flex h-6 w-6 items-center justify-center rounded-md text-muted transition hover:bg-hover hover:text-fg"
      >
        <PlusIcon size={15} />
      </button>
    </div>
  )
}

// ---- list ----

export function ChatList() {
  const agents = useStore((s) => s.agents)
  const rooms = useStore((s) => s.rooms)
  const folders = useStore((s) => s.folders)
  const search = useStore((s) => s.search)
  const selectedId = useStore((s) => s.selectedId)
  const view = useStore((s) => s.view)
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const { setAddOpen, setRoomEditor } = useStore.getState()
  const closeMenu = useCallback(() => setMenu(null), [])

  const byId = useMemo(() => Object.fromEntries(agents.map((a) => [a.id, a])), [agents])
  const chats = useMemo(() => {
    const all: Chat[] = [
      ...rooms.map((chat) => ({ kind: 'room' as const, chat })),
      ...agents.map((chat) => ({ kind: 'agent' as const, chat }))
    ]
    return all.sort((a, b) => b.chat.lastActivity - a.chat.lastActivity)
  }, [agents, rooms])

  const q = search.trim().toLowerCase()
  const matches = q ? chats.filter(({ chat }) => chat.name.toLowerCase().includes(q) || chat.lastPreview.toLowerCase().includes(q)) : chats
  const folderIds = new Set(folders.map((f) => f.id))
  const inFolder = (id: string | null): Chat[] =>
    chats.filter(({ chat }) => (id === null ? !chat.folderId || !folderIds.has(chat.folderId) : chat.folderId === id))

  const openMenu = (e: MouseEvent, items: MenuItem[]): void => {
    e.preventDefault()
    e.stopPropagation()
    setMenu({ x: e.clientX, y: e.clientY, items })
  }

  const chatMenu = (e: MouseEvent, chat: AgentSummary | RoomSummary): void =>
    openMenu(e, [
      { label: 'Move to', heading: true },
      ...folders.map((f) => ({ label: f.name, checked: chat.folderId === f.id, onClick: () => void api.moveToFolder(chat.id, f.id) })),
      { label: 'No folder', checked: !chat.folderId || !folderIds.has(chat.folderId), onClick: () => void api.moveToFolder(chat.id, null) },
      'separator',
      { label: 'New folder…', onClick: () => void newFolder(chat.id) }
    ])

  const folderMenu = (e: MouseEvent, folder: Folder): void =>
    openMenu(e, [
      { label: 'Rename', onClick: () => useStore.setState({ renamingFolderId: folder.id }) },
      { label: 'New agent here', onClick: () => setAddOpen(true, folder.id) },
      'separator',
      { label: 'Delete folder', danger: true, onClick: () => void api.deleteFolder(folder.id) }
    ])

  // Drag and drop: a section highlights while a chat is dragged over it.
  const dropProps = (key: string) => ({
    onDragOver: (e: DragEvent) => {
      if (!e.dataTransfer.types.includes(DRAG_TYPE)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      if (dropTarget !== key) setDropTarget(key)
    },
    onDragLeave: (e: DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropTarget(null)
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault()
      setDropTarget(null)
      const id = e.dataTransfer.getData(DRAG_TYPE)
      if (id) void api.moveToFolder(id, key === NO_FOLDER ? null : key)
    }
  })

  const row = ({ kind, chat }: Chat): ReactNode => {
    const active = view === 'chat' && chat.id === selectedId
    if (kind === 'room') {
      const members = chat.memberIds.map((id) => byId[id]).filter((a): a is AgentSummary => !!a)
      const speaking = chat.speakingId ? byId[chat.speakingId] : undefined
      return (
        <ChatRow
          key={chat.id}
          id={chat.id}
          name={chat.name}
          avatar={<GroupAvatar members={members} size={44} running={chat.status === 'running'} backdrop="var(--sidebar)" />}
          preview={speaking ? `${speaking.name} is typing…` : chat.lastPreview || 'No messages yet'}
          time={chat.status === 'running' ? 'live' : listTime(chat.lastActivity)}
          unread={chat.unread}
          active={active}
          onMenu={(e) => chatMenu(e, chat)}
        />
      )
    }
    return (
      <ChatRow
        key={chat.id}
        id={chat.id}
        name={chat.name}
        avatar={
          <Avatar
            seed={chat.name}
            shape={chat.shape}
            color={chat.color}
            picture={agentPicture(chat.id, chat.avatarVersion)}
            size={44}
            running={chat.status === 'running'}
          />
        }
        preview={chat.lastPreview || 'No messages yet'}
        time={chat.status === 'running' ? 'working…' : listTime(chat.lastActivity)}
        unread={chat.unread}
        active={active}
        onMenu={(e) => chatMenu(e, chat)}
      />
    )
  }

  const sectionClass = (key: string): string =>
    `rounded-xl transition ${dropTarget === key ? 'bg-selected ring-1 ring-accent/50' : ''}`

  return (
    <nav className="flex-1 overflow-y-auto px-2 pb-2" aria-label="Chats">
      {rooms.length === 0 && agents.length >= 2 && !q && (
        <button
          type="button"
          onClick={() => setRoomEditor('new')}
          className="mb-1 flex w-full items-center gap-3 rounded-xl border border-dashed border-line-strong px-2.5 py-2.5 text-left transition hover:border-accent hover:bg-hover"
        >
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent-strong text-on-accent">
            <UsersIcon size={20} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[14px] font-medium">Start a group chat</span>
            <span className="block text-[13px] leading-snug text-muted">Put your agents in one room and let them talk it out</span>
          </span>
        </button>
      )}

      {q || folders.length === 0 ? (
        matches.map(row)
      ) : (
        <>
          {folders.map((folder) => {
            const items = inFolder(folder.id)
            return (
              <section key={folder.id} className={`mb-1 ${sectionClass(folder.id)}`} {...dropProps(folder.id)}>
                <SectionHeader
                  label={<span className="truncate">{folder.name}</span>}
                  folder={folder}
                  unread={folder.collapsed && items.some(({ chat }) => chat.unread > 0)}
                  onAdd={() => setAddOpen(true, folder.id)}
                  onMenu={(e) => folderMenu(e, folder)}
                />
                {!folder.collapsed &&
                  (items.length ? (
                    items.map(row)
                  ) : (
                    <div className="px-2.5 pb-2 text-[12px] text-muted">Empty · drag chats here</div>
                  ))}
              </section>
            )
          })}
          <section className={sectionClass(NO_FOLDER)} {...dropProps(NO_FOLDER)}>
            <SectionHeader label={<span>No folder</span>} onAdd={() => setAddOpen(true)} />
            {inFolder(null).map(row)}
          </section>
        </>
      )}

      {q && <MessageResults query={q} byId={byId} rooms={rooms} />}

      {matches.length === 0 && !q && (
        <div className="px-3 py-8 text-center text-[13px] text-muted">No agents yet. Click + to add one.</div>
      )}

      {menu && <Menu {...menu} onClose={closeMenu} />}
    </nav>
  )
}

/** The search term in bold within a snippet. */
function highlight(text: string, query: string): ReactNode {
  const i = text.toLowerCase().indexOf(query.toLowerCase())
  if (i === -1) return text
  return (
    <>
      {text.slice(0, i)}
      <strong className="font-semibold text-fg">{text.slice(i, i + query.length)}</strong>
      {text.slice(i + query.length)}
    </>
  )
}

/** Searching also looks through every chat's messages; a click opens the chat at that message. */
function MessageResults({ query, byId, rooms }: { query: string; byId: Record<string, AgentSummary>; rooms: RoomSummary[] }) {
  const [hits, setHits] = useState<MessageHit[] | null>(null)

  useEffect(() => {
    if (query.length < 2) {
      setHits([])
      return
    }
    let live = true
    const t = setTimeout(() => {
      void api.searchMessages(query).then((h) => live && setHits(h))
    }, 150)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [query])

  if (query.length < 2 || hits === null) return null
  return (
    <section className="mt-2">
      <div className="px-2.5 pt-1.5 pb-1 text-[11px] font-medium tracking-wide text-muted uppercase">Messages</div>
      {hits.length === 0 && <div className="px-2.5 py-2 text-[12px] text-muted">No messages match.</div>}
      {hits.map((h) => {
        const room = rooms.find((r) => r.id === h.chatId)
        const agent = byId[h.speakerId ?? h.chatId]
        const chatName = room?.name ?? byId[h.chatId]?.name ?? ''
        const who = h.role === 'user' ? 'You' : (agent?.name ?? chatName)
        return (
          <button
            key={h.messageId}
            type="button"
            onClick={() => useStore.getState().openMessage(h.chatId, h.messageId)}
            className="flex w-full items-start gap-2.5 rounded-xl px-2.5 py-2 text-left transition hover:bg-hover"
          >
            {room && !h.speakerId ? (
              <GroupAvatar members={room.memberIds.map((id) => byId[id]).filter((a): a is AgentSummary => !!a)} size={28} backdrop="var(--sidebar)" />
            ) : (
              <Avatar seed={agent?.name ?? chatName} shape={agent?.shape} color={agent?.color} picture={agent ? agentPicture(agent.id, agent.avatarVersion) : null} size={28} />
            )}
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline gap-2">
                <span className="truncate text-[13px] font-medium">{room ? `${chatName} · ${who}` : `${chatName}${h.role === 'user' ? ' · You' : ''}`}</span>
                <span className="ml-auto shrink-0 text-[11px] text-muted">{listTime(h.createdAt)}</span>
              </span>
              <span className="line-clamp-2 block text-[12px] leading-snug text-muted">{highlight(h.snippet, query)}</span>
            </span>
          </button>
        )
      })}
    </section>
  )
}
