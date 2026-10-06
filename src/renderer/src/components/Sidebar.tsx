import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { useStore, type View } from '../lib/store'
import { initials } from '../lib/format'
import { userPicture } from '../lib/avatars'
import { AvatarEditor } from './AvatarEditor'
import { ChatList, newFolder } from './ChatList'
import { UsageMenu } from './UsageMenu'
import {
  BookIcon,
  BriefcaseIcon,
  CheckIcon,
  ClockIcon,
  FolderPlusIcon,
  GearIcon,
  GridIcon,
  LauncherIcon,
  PlusIcon,
  SearchIcon,
  UsersIcon
} from './icons'
import { IconButton } from './ui'

export function Sidebar() {
  const search = useStore((s) => s.search)
  const pendingTotal = useStore((s) => s.agents.reduce((n, x) => n + x.pending, 0))
  const view = useStore((s) => s.view)
  const selectedId = useStore((s) => s.selectedId)
  const settings = useStore((s) => s.settings)
  const userAvatarVersion = useStore((s) => s.userAvatarVersion)
  const { setSearch, setAddOpen, setView, setRoomEditor } = useStore.getState()

  const userName = settings?.userName ?? ''

  // The menu (Today, Jobs, Marketplace, Guide) folds away like a hamburger menu: it closes once you
  // go somewhere, click elsewhere or press Esc.
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  useEffect(() => setMenuOpen(false), [view, selectedId])
  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: MouseEvent): void => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  return (
    <aside className="flex w-[300px] shrink-0 flex-col border-r border-line bg-sidebar">
      {/* Title bar area: leaves room for the traffic lights. */}
      <div className="drag relative flex h-[52px] shrink-0 items-center justify-end gap-1 px-3">
        <UsageMenu />
        <IconButton label="New folder" onClick={() => void newFolder()}>
          <FolderPlusIcon size={18} />
        </IconButton>
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
            placeholder="Search chats and messages"
            className="h-8 w-full rounded-lg bg-elev pr-3 pl-8 text-[13px] text-fg outline-none placeholder:text-muted focus:ring-2 focus:ring-accent/60"
          />
        </div>
      </div>

      <ChatList />

      <div ref={menuRef}>
        <SidebarMenu open={menuOpen} view={view} pending={pendingTotal} onPick={() => setMenuOpen(false)} />

        {/* The profile row shares the agent rows' columns: a 44px leading slot (centred on the agent
            avatars) and the name where agent names start. */}
        <div className="flex items-center gap-1 px-2 pt-1 pb-2.5 pl-4.5">
          <div className="mr-2 flex h-8 w-11 shrink-0 justify-center">
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
            label={menuOpen ? 'Hide menu' : `Today, Jobs, Marketplace, Guide${pendingTotal > 0 ? ` (${pendingTotal} waiting for your OK)` : ''}`}
            aria-expanded={menuOpen}
            aria-controls="sidebar-menu"
            onClick={() => setMenuOpen(!menuOpen)}
            className={`relative ${menuOpen ? 'bg-selected text-fg' : ''}`}
          >
            <LauncherIcon size={17} open={menuOpen} />
            {!menuOpen && pendingTotal > 0 && (
              <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-warn ring-2 ring-sidebar" aria-hidden="true" />
            )}
          </IconButton>
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
      </div>
    </aside>
  )
}

interface Tile {
  label: string
  icon: ReactNode
  /** The screen this tile opens, which marks it as current. */
  view?: View
  run: () => void
}

/** A tray of tiles that unfolds out of the menu button (animated in app.css). */
function SidebarMenu({ open, view, pending, onPick }: { open: boolean; view: View; pending: number; onPick: () => void }) {
  const { setView, setMarketplaceOpen } = useStore.getState()
  const tiles: Tile[] = [
    { label: 'Today', icon: <CheckIcon size={15} />, view: 'today', run: () => setView('today') },
    { label: 'Jobs', icon: <BriefcaseIcon size={15} />, view: 'jobs', run: () => setView('jobs') },
    { label: 'Marketplace', icon: <GridIcon size={15} />, run: () => setMarketplaceOpen(true) },
    { label: 'Guide', icon: <BookIcon size={15} />, view: 'guide', run: () => setView('guide') }
  ]

  return (
    <div id="sidebar-menu" className="launcher px-3" data-open={open} inert={!open}>
      <div className="min-h-0 overflow-hidden">
        <div className="grid grid-cols-2 gap-1.5 pt-2 pb-1">
          {tiles.map((t, i) => {
            const current = !!t.view && t.view === view
            return (
              <button
                key={t.label}
                type="button"
                // Tiles nearest the button (bottom right) arrive first.
                style={{ '--i': tiles.length - 1 - i } as CSSProperties}
                onClick={() => {
                  t.run()
                  onPick()
                }}
                aria-current={current ? 'page' : undefined}
                className={`launcher-tile relative flex items-center gap-2.5 rounded-xl border px-2.5 py-2 text-left text-[13px] font-medium ${
                  current ? 'border-accent/40 bg-selected' : 'border-line bg-elev/60 hover:bg-elev'
                }`}
              >
                <span
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
                    current ? 'bg-accent-strong text-on-accent' : 'bg-accent-strong/15 text-accent'
                  }`}
                >
                  {t.icon}
                </span>
                {t.label}
                {t.view === 'today' && pending > 0 && (
                  <span className="ml-auto rounded-full bg-warn/20 px-1.5 py-0.5 text-[11px] font-semibold text-warn" title="Waiting for your OK">
                    {pending}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
