import { useMemo } from 'react'
import { sortAgents, useStore } from '../lib/store'
import { initials, listTime } from '../lib/format'
import { agentPicture, userPicture } from '../lib/avatars'
import { Avatar } from './Avatar'
import { AvatarEditor } from './AvatarEditor'
import { UsageMenu } from './UsageMenu'
import { ClockIcon, GearIcon, GridIcon, PlusIcon, SearchIcon } from './icons'
import { IconButton } from './ui'

export function Sidebar() {
  const agents = useStore((s) => s.agents)
  const search = useStore((s) => s.search)
  const selectedId = useStore((s) => s.selectedId)
  const view = useStore((s) => s.view)
  const settings = useStore((s) => s.settings)
  const userAvatarVersion = useStore((s) => s.userAvatarVersion)
  const { select, setSearch, setAddOpen, setView } = useStore.getState()

  const list = useMemo(() => {
    const q = search.trim().toLowerCase()
    const sorted = sortAgents(agents)
    return q
      ? sorted.filter((a) => a.name.toLowerCase().includes(q) || a.lastPreview.toLowerCase().includes(q))
      : sorted
  }, [agents, search])

  const userName = settings?.userName ?? ''

  return (
    <aside className="flex w-[300px] shrink-0 flex-col border-r border-line bg-sidebar">
      {/* Title bar area: leaves room for the traffic lights. */}
      <div className="drag relative flex h-[52px] shrink-0 items-center justify-end gap-1 px-3">
        <UsageMenu />
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

      <nav className="flex-1 overflow-y-auto px-2 pb-2" aria-label="Agents">
        {list.map((a) => {
          const active = view === 'chat' && a.id === selectedId
          return (
            <button
              key={a.id}
              type="button"
              onClick={() => select(a.id)}
              className={`flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition ${
                active ? 'bg-selected' : 'hover:bg-hover'
              }`}
            >
              <div className="relative">
                <Avatar seed={a.name} shape={a.shape} color={a.color} picture={agentPicture(a.id, a.avatarVersion)} size={44} running={a.status === 'running'} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className={`truncate text-[14px] ${a.unread ? 'font-semibold' : 'font-medium'}`}>{a.name}</span>
                  <span className="ml-auto shrink-0 text-[12px] text-muted">
                    {a.status === 'running' ? 'working…' : listTime(a.lastActivity)}
                  </span>
                </div>
                <div className="mt-0.5 flex items-center gap-2">
                  <span className={`line-clamp-2 text-[13px] leading-snug ${a.unread ? 'text-fg' : 'text-muted'}`}>
                    {a.lastPreview || 'No messages yet'}
                  </span>
                  {a.unread > 0 && (
                    <span className="ml-auto h-2.5 w-2.5 shrink-0 rounded-full bg-accent" aria-label={`${a.unread} unread`} />
                  )}
                </div>
              </div>
            </button>
          )
        })}
        {list.length === 0 && (
          <div className="px-3 py-8 text-center text-[13px] text-muted">
            {search ? 'No agents match.' : 'No agents yet. Click + to add one.'}
          </div>
        )}
      </nav>

      <div className="px-2 pb-1">
        <button
          type="button"
          onClick={() => useStore.getState().setMarketplaceOpen(true)}
          className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left text-[14px] font-medium transition hover:bg-hover"
        >
          <span className="flex h-7 w-7 items-center justify-center text-muted">
            <GridIcon size={18} />
          </span>
          Marketplace
        </button>
      </div>

      <div className="flex items-center gap-2 border-t border-line px-3 py-2.5">
        <AvatarEditor
          target="user"
          hasPicture={!!userAvatarVersion}
          onChanged={(v) => useStore.setState({ userAvatarVersion: v })}
          label="Change your picture"
          placement="above"
        >
          {userPicture(userAvatarVersion) ? (
            <img src={userPicture(userAvatarVersion) ?? ''} alt="" className="h-8 w-8 rounded-full object-cover" draggable={false} />
          ) : (
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-elev-2 text-[12px] font-semibold">
              {initials(userName)}
            </div>
          )}
        </AvatarEditor>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-medium">{userName}</div>
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
