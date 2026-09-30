import { useStore } from '../lib/store'
import { initials } from '../lib/format'
import { userPicture } from '../lib/avatars'
import { AvatarEditor } from './AvatarEditor'
import { ChatList, newFolder } from './ChatList'
import { UsageMenu } from './UsageMenu'
import { ClockIcon, FolderPlusIcon, GearIcon, GridIcon, PlusIcon, SearchIcon, UsersIcon } from './icons'
import { IconButton } from './ui'

export function Sidebar() {
  const search = useStore((s) => s.search)
  const view = useStore((s) => s.view)
  const settings = useStore((s) => s.settings)
  const userAvatarVersion = useStore((s) => s.userAvatarVersion)
  const { setSearch, setAddOpen, setView, setRoomEditor } = useStore.getState()

  const userName = settings?.userName ?? ''

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
            placeholder="Search"
            className="h-8 w-full rounded-lg bg-elev pr-3 pl-8 text-[13px] text-fg outline-none placeholder:text-muted focus:ring-2 focus:ring-accent/60"
          />
        </div>
      </div>

      <ChatList />

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
