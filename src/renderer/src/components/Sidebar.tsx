import { useMemo, type ReactNode } from 'react'
import type { AgentSummary, RoomSummary } from '@shared/types'
import { useStore } from '../lib/store'
import { initials, listTime } from '../lib/format'
import { agentPicture, userPicture } from '../lib/avatars'
import { Avatar } from './Avatar'
import { AvatarEditor } from './AvatarEditor'
import { GroupAvatar } from './GroupAvatar'
import { UsageMenu } from './UsageMenu'
import { ClockIcon, GearIcon, GridIcon, PlusIcon, SearchIcon, UsersIcon } from './icons'
import { IconButton } from './ui'

type Chat = { kind: 'agent'; chat: AgentSummary } | { kind: 'room'; chat: RoomSummary }

function ChatRow({
  name,
  avatar,
  preview,
  time,
  unread,
  active,
  onClick
}: {
  name: string
  avatar: ReactNode
  preview: string
  time: string
  unread: number
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
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

export function Sidebar() {
  const agents = useStore((s) => s.agents)
  const rooms = useStore((s) => s.rooms)
  const search = useStore((s) => s.search)
  const selectedId = useStore((s) => s.selectedId)
  const view = useStore((s) => s.view)
  const settings = useStore((s) => s.settings)
  const userAvatarVersion = useStore((s) => s.userAvatarVersion)
  const { select, setSearch, setAddOpen, setView, setRoomEditor } = useStore.getState()

  const byId = useMemo(() => Object.fromEntries(agents.map((a) => [a.id, a])), [agents])
  const list = useMemo(() => {
    const q = search.trim().toLowerCase()
    const chats: Chat[] = [
      ...rooms.map((chat) => ({ kind: 'room' as const, chat })),
      ...agents.map((chat) => ({ kind: 'agent' as const, chat }))
    ]
    const sorted = chats.sort((a, b) => b.chat.lastActivity - a.chat.lastActivity)
    return q
      ? sorted.filter(({ chat }) => chat.name.toLowerCase().includes(q) || chat.lastPreview.toLowerCase().includes(q))
      : sorted
  }, [agents, rooms, search])

  const userName = settings?.userName ?? ''

  return (
    <aside className="flex w-[300px] shrink-0 flex-col border-r border-line bg-sidebar">
      {/* Title bar area: leaves room for the traffic lights. */}
      <div className="drag relative flex h-[52px] shrink-0 items-center justify-end gap-1 px-3">
        <UsageMenu />
        <IconButton label="New group chat (⇧⌘N)" onClick={() => setRoomEditor('new')}>
          <UsersIcon size={18} />
        </IconButton>
        <IconButton label="New agent (⌘N)" onClick={() => setAddOpen(true)}>
          <PlusIcon size={18} />
        </IconButton>
      </div>

      <div className="px-3 pb-2">
        <div className="relative">
          <SearchIcon size={14} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search"
            className="h-8 w-full rounded-lg bg-elev pr-3 pl-8 text-[13px] text-fg outline-none placeholder:text-muted focus:ring-2 focus:ring-accent/60"
          />
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 pb-2" aria-label="Chats">
        {rooms.length === 0 && agents.length >= 2 && !search && (
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
        {list.map(({ kind, chat }) => {
          const active = view === 'chat' && chat.id === selectedId
          if (kind === 'room') {
            const members = chat.memberIds.map((id) => byId[id]).filter((a): a is AgentSummary => !!a)
            const speaking = chat.speakingId ? byId[chat.speakingId] : undefined
            return (
              <ChatRow
                key={chat.id}
                name={chat.name}
                avatar={<GroupAvatar members={members} size={44} running={chat.status === 'running'} backdrop="var(--sidebar)" />}
                preview={speaking ? `${speaking.name} is typing…` : chat.lastPreview || 'No messages yet'}
                time={chat.status === 'running' ? 'live' : listTime(chat.lastActivity)}
                unread={chat.unread}
                active={active}
                onClick={() => select(chat.id)}
              />
            )
          }
          return (
            <ChatRow
              key={chat.id}
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
              onClick={() => select(chat.id)}
            />
          )
        })}
        {list.length === 0 && (
          <div className="px-3 py-8 text-center text-[13px] text-muted">
            {search ? 'No chats match.' : 'No agents yet. Click + to add one.'}
          </div>
        )}
      </nav>

      {/* Marketplace and profile share the agent rows' columns: a 44px leading slot
          (centred on the agent avatars) and the label where agent names start. */}
      <div className="px-2">
        <button
          type="button"
          onClick={() => useStore.getState().setMarketplaceOpen(true)}
          className="flex w-full items-center gap-3 rounded-xl px-2.5 py-1.5 text-left text-[14px] font-medium transition hover:bg-hover"
        >
          <span className="flex h-8 w-11 shrink-0 items-center justify-center text-muted">
            <GridIcon size={19} />
          </span>
          Marketplace
        </button>
      </div>

      <div className="flex items-center gap-3 px-2 pt-1 pb-2.5 pl-4.5">
        <div className="flex h-8 w-11 shrink-0 justify-center">
          <AvatarEditor
            target="user"
            hasPicture={!!userAvatarVersion}
            onChanged={(v) => useStore.setState({ userAvatarVersion: v })}
            label="Change your picture"
            placement="above"
          >
            {userPicture(userAvatarVersion) ? (
              <img src={userPicture(userAvatarVersion) ?? ''} alt="" className="h-8 w-8 rounded-full object-cover shadow-[0_2px_5px_rgb(0_0_0/0.22)]" draggable={false} />
            ) : (
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-elev-2 text-[12px] font-semibold shadow-[0_1px_3px_rgb(0_0_0/0.15)]">
                {initials(userName)}
              </div>
            )}
          </AvatarEditor>
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-medium">{userName}</div>
        </div>
        <IconButton
          label="Routines (⇧⌘R)"
          onClick={() => setView('routines')}
          className={view === 'routines' ? 'bg-selected text-fg' : ''}
        >
          <ClockIcon size={17} />
        </IconButton>
        <IconButton
          label="Settings (⌘,)"
          onClick={() => setView('settings')}
          className={view === 'settings' ? 'bg-selected text-fg' : ''}
        >
          <GearIcon size={17} />
        </IconButton>
      </div>
    </aside>
  )
}
