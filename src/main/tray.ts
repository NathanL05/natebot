// Menu-bar icon so NateBot (and its routines) keep running with the window closed.
import { Menu, nativeImage, Tray } from 'electron'
import { join } from 'node:path'
import { promptLabel, type AgentSummary } from '@shared/types'

let tray: Tray | null = null

export function createTray(opts: {
  resourcesDir: string
  onOpen: () => void
  onOpenAgent: (id: string) => void
  onRoutines: () => void
  onToday: () => void
  /** Sends one of an agent's quick prompts without opening the window. */
  onQuickPrompt: (agentId: string, prompt: string) => void
  /** Opens the quick-capture box. */
  onCapture: () => void
  onQuit: () => void
}): { update: (agents: AgentSummary[]) => void } {
  const icon = nativeImage.createFromPath(join(opts.resourcesDir, 'trayTemplate.png'))
  icon.setTemplateImage(true)
  tray = new Tray(icon)
  tray.setToolTip('NateBot')

  const update = (agents: AgentSummary[]): void => {
    if (!tray) return
    const busy = agents.filter((a) => a.status === 'running').length
    const unread = agents.reduce((n, a) => n + a.unread, 0)
    tray.setTitle(busy ? ` ${busy}` : '')
    const recent = [...agents].sort((a, b) => b.lastActivity - a.lastActivity).slice(0, 8)
    const short = (s: string): string => (s.length > 48 ? `${s.slice(0, 47)}…` : s)
    const quick = agents
      .flatMap((a) => a.quick_prompts.map((p) => ({ label: `${a.name}: ${short(promptLabel(p).text)}`, click: () => opts.onQuickPrompt(a.id, p) })))
      .slice(0, 10)
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Open NateBot', click: opts.onOpen },
        { label: 'Message an agent…', click: opts.onCapture },
        { type: 'separator' },
        ...(busy ? [{ label: `${busy} agent${busy > 1 ? 's' : ''} working…`, enabled: false }] : []),
        ...(unread ? [{ label: `${unread} unread`, enabled: false }] : []),
        ...recent.map((a) => ({
          label: `${a.name}${a.status === 'running' ? '  ·  working' : a.unread ? '  ·  new' : ''}`,
          click: () => opts.onOpenAgent(a.id)
        })),
        ...(quick.length
          ? [{ type: 'separator' as const }, { label: 'Quick prompts (reply comes as a notification)', enabled: false }, ...quick]
          : []),
        { type: 'separator' },
        { label: 'Today', click: opts.onToday },
        { label: 'Routines & reminders', click: opts.onRoutines },
        { type: 'separator' },
        { label: 'Quit NateBot', accelerator: 'Cmd+Q', click: opts.onQuit }
      ])
    )
  }

  return { update }
}
