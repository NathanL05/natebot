import { app, screen, type BrowserWindow, type Rectangle } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const DEFAULT = { width: 1200, height: 750 }
const file = (): string => join(app.getPath('userData'), 'window-state.json')

/** Returns saved bounds if they still fit on a connected display. */
export function loadBounds(): Partial<Rectangle> {
  try {
    const saved = JSON.parse(readFileSync(file(), 'utf8')) as Rectangle
    const visible = screen.getAllDisplays().some(({ workArea: a }) =>
      saved.x >= a.x - 50 && saved.y >= a.y - 50 &&
      saved.x + 100 <= a.x + a.width && saved.y + 100 <= a.y + a.height
    )
    return visible ? saved : DEFAULT
  } catch {
    return DEFAULT
  }
}

export function trackBounds(win: BrowserWindow): void {
  let timer: NodeJS.Timeout | undefined
  const save = (): void => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      if (win.isDestroyed() || win.isMinimized() || win.isFullScreen()) return
      try {
        writeFileSync(file(), JSON.stringify(win.getNormalBounds()))
      } catch {
        // Non-fatal: we just won't remember the size.
      }
    }, 400)
  }
  win.on('resize', save)
  win.on('move', save)
}
