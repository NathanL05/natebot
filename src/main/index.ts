import { app, BrowserWindow, Menu, nativeImage, shell, type MenuItemConstructorOptions } from 'electron'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { userInfo } from 'node:os'
import { join } from 'node:path'
import { emit, registerApi } from './ipc'
import { MockBackend } from './mock-backend'
import { loadBounds, trackBounds } from './window-state'

app.setName('NateBot')

const isDev = !app.isPackaged
const devServerUrl = isDev ? process.env['ELECTRON_RENDERER_URL'] : undefined

// Dev only: lets automated UI checks attach over the Chrome DevTools Protocol.
const cdpPort = process.env['NATEBOT_CDP_PORT']
if (isDev && cdpPort) app.commandLine.appendSwitch('remote-debugging-port', cdpPort)

let mainWindow: BrowserWindow | null = null
let quitting = false

function fullName(): string {
  try {
    return execFileSync('/usr/bin/id', ['-F'], { encoding: 'utf8', timeout: 2000 }).trim() || userInfo().username
  } catch {
    return userInfo().username
  }
}

const backend = new MockBackend(fullName())

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    ...loadBounds(),
    minWidth: 760,
    minHeight: 500,
    title: 'NateBot',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 20 },
    backgroundColor: '#1C1C1E',
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

  win.once('ready-to-show', () => win.show())

  // Closing the window hides it; the app keeps running for routines.
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

function showWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) mainWindow = createWindow()
  mainWindow.show()
  mainWindow.focus()
}

function buildMenu(): void {
  const nav = (target: 'settings' | 'routines' | 'newAgent') => () => {
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
        { label: 'Routines', accelerator: 'Cmd+Shift+R', click: nav('routines') },
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
    { role: 'windowMenu' }
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

app.whenReady().then(() => {
  app.setAboutPanelOptions({
    applicationName: 'NateBot',
    applicationVersion: app.getVersion(),
    copyright: 'Personal multi-agent assistant, powered by Claude Code'
  })

  // Packaged builds get the icon from the .icns; in dev set it on the Dock.
  const devIcon = join(__dirname, '../../resources/icon.png')
  if (isDev && existsSync(devIcon)) app.dock?.setIcon(nativeImage.createFromPath(devIcon))

  registerApi(backend, devServerUrl)
  buildMenu()
  mainWindow = createWindow()

  app.on('activate', showWindow)
})

app.on('before-quit', () => {
  quitting = true
})

// On macOS the app stays alive with no windows (routines keep running).
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
