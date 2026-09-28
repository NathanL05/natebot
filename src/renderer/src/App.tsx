import { useEffect } from 'react'
import { useStore } from './lib/store'
import { AddAgentModal } from './components/AddAgentModal'
import { ChatView } from './components/ChatView'
import { ConnectGmailModal } from './components/ConnectGmailModal'
import { MarketplaceModal } from './components/MarketplaceModal'
import { RoutinesView } from './components/RoutinesView'
import { SettingsView } from './components/SettingsView'
import { SetupScreen } from './components/SetupScreen'
import { Sidebar } from './components/Sidebar'

export function App() {
  const ready = useStore((s) => s.ready)
  const env = useStore((s) => s.env)
  const view = useStore((s) => s.view)
  const addOpen = useStore((s) => s.addOpen)
  const gmailOpen = useStore((s) => s.gmailOpen)
  const marketplaceOpen = useStore((s) => s.marketplaceOpen)
  const theme = useStore((s) => s.settings?.theme ?? 'dark')

  useEffect(() => {
    void useStore.getState().init()
  }, [])

  useEffect(() => {
    document.documentElement.dataset['theme'] = theme
  }, [theme])

  if (!ready || env?.checking) return <div className="drag h-full" />
  if (env && !(env.claudeFound && env.loggedIn)) return <SetupScreen env={env} />

  return (
    <div className="flex h-full">
      <Sidebar />
      <main className="flex min-w-0 flex-1">
        {view === 'chat' && <ChatView />}
        {view === 'routines' && <RoutinesView />}
        {view === 'settings' && <SettingsView />}
      </main>
      {addOpen && <AddAgentModal />}
      {gmailOpen && <ConnectGmailModal />}
      {marketplaceOpen && <MarketplaceModal />}
    </div>
  )
}
