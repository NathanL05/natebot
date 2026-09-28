import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { API_METHODS, type NateBotApi, type NateBotEvents } from '@shared/ipc'

let trustedOrigin: string | null = null

/** Only our own renderer (dev server or bundled file) may call the API. */
function isTrusted(event: IpcMainInvokeEvent): boolean {
  const url = event.senderFrame?.url ?? ''
  if (url.startsWith('file://')) return true
  return trustedOrigin !== null && url.startsWith(trustedOrigin)
}

export function registerApi(impl: NateBotApi, devServerUrl?: string): void {
  trustedOrigin = devServerUrl ? new URL(devServerUrl).origin : null
  for (const method of API_METHODS) {
    ipcMain.handle(`api:${method}`, (event, ...args: unknown[]) => {
      if (!isTrusted(event)) throw new Error('Untrusted sender')
      return Reflect.apply(impl[method], impl, args)
    })
  }
}

export function emit<K extends keyof NateBotEvents>(event: K, payload: NateBotEvents[K]): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(`evt:${event}`, payload)
  }
}
