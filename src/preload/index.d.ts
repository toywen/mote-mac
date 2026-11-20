declare global {
  interface Window {
    mote: Record<string, never>
  }
}

export {}
