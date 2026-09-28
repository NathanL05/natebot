// Menu-bar icon so NateBot (and its routines) keep running with the window closed.
import { app, Menu, nativeImage, Tray } from 'electron'
import { join } from 'node:path'
import type { AgentSummary } from '@shared/types'

let tray: Tray | null = null

export function createTray(opts: {
  resourcesDir: string
  onOpen: () => void
  onOpenAgent: (id: string) => void
  onRoutines: () => void
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
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Open NateBot', click: opts.onOpen },
        { type: 'separator' },
        ...(busy ? [{ label: `${busy} agent${busy > 1 ? 's' : ''} working…`, enabled: false }] : []),
        ...(unread ? [{ label: `${unread} unread`, enabled: false }] : []),
        ...recent.map((a) => ({
          label: `${a.icon}  ${a.name}${a.status === 'running' ? '  ·  working' : a.unread ? '  ·  new' : ''}`,
          click: () => opts.onOpenAgent(a.id)
        })),
        { type: 'separator' },
        { label: 'Routines', click: opts.onRoutines },
        { type: 'separator' },
        { label: 'Quit NateBot', accelerator: 'Cmd+Q', click: () => app.quit() }
      ])
    )
  }

  return { update }
}
