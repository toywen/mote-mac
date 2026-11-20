import { contextBridge } from 'electron'

const mote = {}

contextBridge.exposeInMainWorld('mote', mote)
