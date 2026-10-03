import { useEffect } from 'react'
import { accentById, onFill } from '@shared/accents'
import { useSelectedRoom, useStore } from './lib/store'
import { AddAgentModal } from './components/AddAgentModal'
import { ChatView } from './components/ChatView'
import { ConnectCalendarModal } from './components/ConnectCalendarModal'
import { ConnectGmailModal } from './components/ConnectGmailModal'
import { MarketplaceModal } from './components/MarketplaceModal'
import { RoomModal } from './components/RoomModal'
import { RoomView } from './components/RoomView'
import { RoutinesView } from './components/RoutinesView'
import { TodayView } from './components/TodayView'
import { SettingsView } from './components/SettingsView'
import { SetupScreen } from './components/SetupScreen'
import { Sidebar } from './components/Sidebar'

export function App() {
  const ready = useStore((s) => s.ready)
  const env = useStore((s) => s.env)
  const view = useStore((s) => s.view)
  const addOpen = useStore((s) => s.addOpen)
  const gmailOpen = useStore((s) => s.gmailOpen)
  const calendarOpen = useStore((s) => s.calendarOpen)
  const marketplaceOpen = useStore((s) => s.marketplaceOpen)
  const roomEditor = useStore((s) => s.roomEditor)
  const room = useSelectedRoom()
  const theme = useStore((s) => s.settings?.theme ?? 'dark')
  const accent = useStore((s) => s.settings?.accent ?? 'violet')

  useEffect(() => {
    void useStore.getState().init()
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
        {view === 'chat' && (room ? <RoomView room={room} /> : <ChatView />)}
        {view === 'today' && <TodayView />}
        {view === 'routines' && <RoutinesView />}
        {view === 'settings' && <SettingsView />}
      </main>
      {addOpen && <AddAgentModal />}
      {gmailOpen && <ConnectGmailModal />}
      {calendarOpen && <ConnectCalendarModal />}
      {marketplaceOpen && <MarketplaceModal />}
      {roomEditor && <RoomModal key={roomEditor} />}
    </div>
  )
}
