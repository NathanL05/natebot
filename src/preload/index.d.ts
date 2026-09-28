import type { NateBotBridge } from '../shared/ipc'

declare global {
  interface Window {
    natebot: NateBotBridge
  }
}

export {}
