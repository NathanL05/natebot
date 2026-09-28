import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { API_METHODS, EVENT_NAMES, type NateBotEvents } from '@shared/ipc'

// The renderer gets exactly the API methods and events defined in shared/ipc.ts.
const bridge: Record<string, unknown> = {}

for (const method of API_METHODS) {
  bridge[method] = (...args: unknown[]) => ipcRenderer.invoke(`api:${method}`, ...args)
}

bridge['on'] = <K extends keyof NateBotEvents>(event: K, cb: (payload: NateBotEvents[K]) => void) => {
  if (!(EVENT_NAMES as readonly string[]).includes(event)) throw new Error(`Unknown event: ${event}`)
  const listener = (_e: IpcRendererEvent, payload: NateBotEvents[K]): void => cb(payload)
  ipcRenderer.on(`evt:${event}`, listener)
  return () => {
    ipcRenderer.removeListener(`evt:${event}`, listener)
  }
}

contextBridge.exposeInMainWorld('natebot', bridge)
