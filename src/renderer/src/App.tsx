import { useEffect } from 'react'
import { accentById, onFill } from '@shared/accents'
import { useSelectedRoom, useStore } from './lib/store'
import { AddAgentModal } from './components/AddAgentModal'
import { ChatView } from './components/ChatView'
import { ConnectGoogleModal } from './components/ConnectGoogleModal'
import { ConnectGmailModal } from './components/ConnectGmailModal'
import { MarketplaceModal } from './components/MarketplaceModal'
import { RoomModal } from './components/RoomModal'
import { RoomView } from './components/RoomView'
import { RoutinesView } from './components/RoutinesView'
import { TodayView } from './components/TodayView'
import { CommandPalette } from './components/CommandPalette'
import { ErrorBoundary } from './components/ErrorBoundary'
import { GuideView } from './components/GuideView'
import { JobsView } from './components/JobsView'
import { SettingsView } from './components/SettingsView'
import { SetupScreen } from './components/SetupScreen'
import { Sidebar } from './components/Sidebar'

export function App() {
  const ready = useStore((s) => s.ready)
  const env = useStore((s) => s.env)
  const view = useStore((s) => s.view)
  const addOpen = useStore((s) => s.addOpen)
  const gmailOpen = useStore((s) => s.gmailOpen)
  const googleOpen = useStore((s) => s.googleOpen)
  const marketplaceOpen = useStore((s) => s.marketplaceOpen)
  const roomEditor = useStore((s) => s.roomEditor)
  const room = useSelectedRoom()
  const theme = useStore((s) => s.settings?.theme ?? 'dark')
  const accent = useStore((s) => s.settings?.accent ?? 'violet')

  const paletteOpen = useStore((s) => s.paletteOpen)
  const selectedId = useStore((s) => s.selectedId)

  useEffect(() => {
    void useStore.getState().init()
    // ⌘K toggles the command palette from anywhere in the window.
    const onKey = (e: KeyboardEvent): void => {
      if (e.metaKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        useStore.setState((s) => ({ paletteOpen: !s.paletteOpen }))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    document.documentElement.dataset['theme'] = theme
    const { text, fill } = accentById(accent)[theme]
    const root = document.documentElement.style
    root.setProperty('--accent', text)
    root.setProperty('--accent-strong', fill)
    root.setProperty('--on-accent', onFill(fill))
  }, [theme, accent])

  if (!ready || env?.checking) return <div className="drag h-full" />
  if (env && !(env.claudeFound && env.loggedIn)) return <SetupScreen env={env} />

  return (
    <div className="flex h-full">
      <Sidebar />
      <main className="flex min-w-0 flex-1">
        {/* A screen that fails to render leaves the sidebar working; switching chats or screens resets it. */}
        <ErrorBoundary resetKey={`${view}:${selectedId ?? ''}`}>
          {view === 'chat' && (room ? <RoomView room={room} /> : <ChatView />)}
          {view === 'today' && <TodayView />}
          {view === 'jobs' && <JobsView />}
          {view === 'routines' && <RoutinesView />}
          {view === 'settings' && <SettingsView />}
          {view === 'guide' && <GuideView />}
        </ErrorBoundary>
      </main>
      {addOpen && <AddAgentModal />}
      {gmailOpen && <ConnectGmailModal />}
      {googleOpen && <ConnectGoogleModal server={googleOpen} />}
      {paletteOpen && <CommandPalette />}
      {marketplaceOpen && <MarketplaceModal />}
      {roomEditor && <RoomModal key={roomEditor} />}
    </div>
  )
}
