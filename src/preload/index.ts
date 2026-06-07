import { contextBridge, ipcRenderer } from 'electron'
import type {
  AccountInput,
  SteamDeskApi,
  TaskInput,
  WorkspaceSettings,
  WorkspaceSnapshot
} from '../shared/types'

const api: SteamDeskApi = {
  getSnapshot: () => ipcRenderer.invoke('workspace:get'),
  addAccount: (input: AccountInput) => ipcRenderer.invoke('accounts:add', input),
  removeAccount: (accountId: string) => ipcRenderer.invoke('accounts:remove', accountId),
  createTask: (input: TaskInput) => ipcRenderer.invoke('tasks:create', input),
  pauseTask: (taskId: string) => ipcRenderer.invoke('tasks:pause', taskId),
  resumeTask: (taskId: string) => ipcRenderer.invoke('tasks:resume', taskId),
  cancelTask: (taskId: string) => ipcRenderer.invoke('tasks:cancel', taskId),
  removeTask: (taskId: string) => ipcRenderer.invoke('tasks:remove', taskId),
  clearActivity: () => ipcRenderer.invoke('activity:clear'),
  updateSettings: (settings: WorkspaceSettings) =>
    ipcRenderer.invoke('settings:update', settings),
  openExternal: (url: string) => ipcRenderer.invoke('external:open', url),
  copyText: (text: string) => ipcRenderer.invoke('clipboard:copy', text),
  windowControl: (action: 'minimize' | 'maximize' | 'fullscreen' | 'close') =>
    ipcRenderer.invoke('window:control', action),
  onSnapshot: (callback: (snapshot: WorkspaceSnapshot) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, snapshot: WorkspaceSnapshot): void =>
      callback(snapshot)
    ipcRenderer.on('workspace:snapshot', listener)
    return () => ipcRenderer.removeListener('workspace:snapshot', listener)
  }
}

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('api', api)
} else {
  // @ts-ignore fallback for disabled context isolation
  window.api = api
}
