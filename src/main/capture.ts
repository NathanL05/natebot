// Quick capture: a global shortcut opens a small box over whatever app you're in,
// to send a message to any agent without opening NateBot's window. The reply
// arrives like any other, with a notification while NateBot isn't in front.
import { app, BrowserWindow, globalShortcut, screen } from 'electron'
import { join } from 'node:path'
import { emit } from './ipc'

const WIDTH = 640
const HEIGHT = 196

export interface Capture {
  /** Registers the shortcut (null turns it off). Returns false if another app already uses it. */
  setShortcut(accelerator: string | null): boolean
  show(): void
  hide(): void
}

export function createCapture(opts: { load: (win: BrowserWindow, hash: string) => void }): Capture {
  let win: BrowserWindow | null = null
  let current: string | null = null
  /** Whether NateBot was already in front when the box opened (if not, give focus back on close). */
  let wasActive = false

  const make = (): BrowserWindow => {
    const w = new BrowserWindow({
      width: WIDTH,
      height: HEIGHT,
      show: false,
      frame: false,
      transparent: true,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      hasShadow: false,
      title: 'NateBot Quick Capture',
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        spellcheck: true
      }
    })
    w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    w.on('blur', () => hide())
    w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    w.webContents.on('will-navigate', (e) => e.preventDefault())
    opts.load(w, 'capture')
    return w
  }

  const show = (): void => {
    if (!win || win.isDestroyed()) win = make()
    wasActive = BrowserWindow.getFocusedWindow() !== null
    // Centred near the top of the screen the pointer is on.
    const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    win.setBounds({ x: Math.round(workArea.x + (workArea.width - WIDTH) / 2), y: Math.round(workArea.y + workArea.height * 0.2), width: WIDTH, height: HEIGHT })
    const ready = win
    const reveal = (): void => {
      ready.show()
      ready.focus()
      app.focus({ steal: true })
      emit('captureShown', Date.now())
    }
    if (ready.webContents.isLoading()) ready.webContents.once('did-finish-load', reveal)
    else reveal()
  }

  const hide = (): void => {
    if (!win || win.isDestroyed() || !win.isVisible()) return
    win.hide()
    // Return to the app you were in, unless you opened the box from NateBot itself.
    if (!wasActive) app.hide()
  }

  const setShortcut = (accelerator: string | null): boolean => {
    if (current) globalShortcut.unregister(current)
    current = null
    if (!accelerator) return true
    try {
      if (!globalShortcut.register(accelerator, () => (win?.isVisible() ? hide() : show()))) return false
    } catch {
      return false
    }
    current = accelerator
    return true
  }

  app.on('will-quit', () => globalShortcut.unregisterAll())
  return { setShortcut, show, hide }
}
