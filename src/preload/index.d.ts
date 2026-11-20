import type { MoteApi } from '../core/ipc'

declare global {
  interface Window {
    mote: MoteApi
  }
}

export {}
