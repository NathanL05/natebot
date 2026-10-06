import { app, BrowserWindow, Menu, nativeImage, shell, type MenuItemConstructorOptions } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { handleAvatarProtocol, registerAvatarScheme } from './avatars'
import { Backend } from './backend'
import type { NateBotEvents } from '@shared/ipc'
import { emit, registerApi } from './ipc'
import { createCapture } from './capture'
import { parseShareLink } from './share'
import { createTray } from './tray'
import { loadBounds, trackBounds } from './window-state'

app.setName('NateBot')

const isDev = !app.isPackaged
const devServerUrl = isDev ? process.env['ELECTRON_RENDERER_URL'] : undefined
const resourcesDir = join(__dirname, '../../resources')

// Dev only: lets automated UI checks attach over the Chrome DevTools Protocol.
const cdpPort = process.env['NATEBOT_CDP_PORT']
if (isDev && cdpPort) app.commandLine.appendSwitch('remote-debugging-port', cdpPort)

registerAvatarScheme()

// One NateBot at a time; a second launch just shows the existing window. The second copy
// must never get as far as opening the database or tidying the temp folder under the first.
const primary = app.requestSingleInstanceLock()
if (!primary) app.quit()

// natebot://capture?text=…&agent=… (e.g. from a Shortcuts "Share" action) opens the
// quick-capture box pre-filled. Any web page can open such a link, so it never sends anything.
let openCapture: ((prefill: { text?: string; agent?: string }) => void) | null = null
let pendingLink: string | null = null
function handleLink(url: string): void {
  if (!openCapture) {
    pendingLink = url
    return
  }
  const prefill = parseShareLink(url)
  if (prefill) openCapture(prefill)
}
app.on('open-url', (e, url) => {
  e.preventDefault()
  handleLink(url)
})
// The packaged app registers the scheme in its Info.plist; a dev copy must not take it over.
if (app.isPackaged) app.setAsDefaultProtocolClient('natebot')

let mainWindow: BrowserWindow | null = null
let quitting = false
let backend: Backend

const BACKGROUNDS = { dark: '#0E0E13', light: '#FFFFFF' } as const

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    ...loadBounds(),
    minWidth: 760,
    minHeight: 500,
    title: 'NateBot',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 20 },
    backgroundColor: BACKGROUNDS[backend.settings.get().theme],
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: true
    }
  })
  trackBounds(win)

  win.once('ready-to-show', () => {
    if (!startHidden) win.show()
  })

  // Closing the window hides it; NateBot keeps running in the menu bar.
  win.on('close', (e) => {
    if (!quitting) {
      e.preventDefault()
      win.hide()
    }
  })

  // Never navigate away from the app or open new Electron windows.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(https?:|mailto:)/i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (devServerUrl && url.startsWith(devServerUrl)) return
    e.preventDefault()
  })

  if (devServerUrl) void win.loadURL(devServerUrl)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
  return win
}

let startHidden = false

function showWindow(): void {
  startHidden = false
  if (!mainWindow || mainWindow.isDestroyed()) mainWindow = createWindow()
  if (mainWindow.webContents.isLoading()) mainWindow.once('ready-to-show', () => mainWindow?.show())
  else mainWindow.show()
  mainWindow.focus()
}

function openAgent(agentId: string): void {
  showWindow()
  emit('focusAgent', agentId)
}

function buildMenu(): void {
  const nav = (target: NateBotEvents['navigate']) => () => {
    showWindow()
    emit('navigate', target)
  }
  const template: MenuItemConstructorOptions[] = [
    {
      label: 'NateBot',
      submenu: [
        { role: 'about', label: 'About NateBot' },
        { type: 'separator' },
        { label: 'Settings…', accelerator: 'Cmd+,', click: nav('settings') },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide', label: 'Hide NateBot' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit', label: 'Quit NateBot' }
      ]
    },
    {
      label: 'File',
      submenu: [
        { label: 'New Agent…', accelerator: 'Cmd+N', click: nav('newAgent') },
        { label: 'New Group Chat…', accelerator: 'Cmd+Shift+N', click: nav('newRoom') },
        { label: 'Today', accelerator: 'Cmd+Shift+T', click: nav('today') },
        { label: 'Jobs', accelerator: 'Cmd+Shift+J', click: nav('jobs') },
        { label: 'Routines', accelerator: 'Cmd+Shift+R', click: nav('routines') },
        { type: 'separator' },
        { label: 'Show Data Folder', click: () => void shell.openPath(join(app.getPath('home'), 'NateBot')) },
        { type: 'separator' },
        { role: 'close' }
      ]
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        ...(isDev ? [{ role: 'reload' as const }, { role: 'toggleDevTools' as const }, { type: 'separator' as const }] : []),
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [{ label: 'NateBot Guide', accelerator: 'Cmd+/', click: nav('guide') }]
    }
  ]
  if (isDev) {
    template.push({
      label: 'Debug',
      submenu: [
        { label: 'Simulate usage limit', type: 'checkbox', click: (item) => backend.simulateUsageLimit(item.checked) },
        { label: 'Simulate setup problem', type: 'checkbox', click: (item) => backend.simulateSetupProblem(item.checked) }
      ]
    })
  }
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

app.on('second-instance', showWindow)

app.whenReady().then(async () => {
  if (!primary) return
  app.setAboutPanelOptions({
    applicationName: 'NateBot',
    applicationVersion: app.getVersion(),
    copyright: 'Personal multi-agent assistant, powered by your Claude Code subscription'
  })

  const devIcon = join(resourcesDir, 'icon.png')
  if (isDev && existsSync(devIcon)) app.dock?.setIcon(nativeImage.createFromPath(devIcon))

  // Launched at login: start quietly in the menu bar.
  startHidden = app.isPackaged && app.getLoginItemSettings().wasOpenedAtLogin === true

  handleAvatarProtocol()
  backend = new Backend()
  registerApi(backend, devServerUrl)
  buildMenu()

  const capture = createCapture({
    load: (win, hash) => {
      if (devServerUrl) void win.loadURL(`${devServerUrl}#${hash}`)
      else void win.loadFile(join(__dirname, '../renderer/index.html'), { hash })
    }
  })
  backend.onCaptureShortcut = capture.setShortcut
  backend.onHideCapture = capture.hide
  backend.applyCaptureShortcut()
  openCapture = (prefill) => capture.show(prefill)
  if (pendingLink) handleLink(pendingLink)
  pendingLink = null

  const tray = createTray({
    resourcesDir,
    onOpen: showWindow,
    onOpenAgent: openAgent,
    onRoutines: () => {
      showWindow()
      emit('navigate', 'routines')
    },
    onToday: () => {
      showWindow()
      emit('navigate', 'today')
    },
    onQuickPrompt: (agentId, prompt) => void backend.sendMessage(agentId, prompt),
    onCapture: () => capture.show()
  })
  backend.onAgentsChanged = tray.update
  backend.onOpenAgent = openAgent
  backend.onShowView = (view) => {
    showWindow()
    emit('navigate', view)
  }

  mainWindow = createWindow()
  await backend.start()
  tray.update((await backend.bootstrap()).agents)

  app.on('activate', showWindow)
})

app.on('before-quit', () => {
  quitting = true
  backend?.shutdown()
})

// NateBot stays alive with no windows so routines keep running.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
