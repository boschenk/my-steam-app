// -----------------------------------------------------------------------------
// Файл: src/preload/index.ts
// Описание: Безопасный мост (Context Bridge) между UI и Electron Main Process
// -----------------------------------------------------------------------------

import { contextBridge, ipcRenderer } from 'electron'
import type {
  AccountInput,
  OrderInput,
  Service,
  SteamDeskApi,
  OrderStatus,
  ManualTaskStatus,
  TaskInput,
  WorkspaceSettings,
  WorkspaceSnapshot
} from '../shared/types'

const api: SteamDeskApi = {
  // Получение общего состояния (Снапшот)
  getSnapshot: () => ipcRenderer.invoke('workspace:get'),
  
  // ==========================================
  // МЕТОДЫ АККАУНТОВ (Массовая загрузка, боты)
  // ==========================================
  addAccount: (input: AccountInput) => ipcRenderer.invoke('accounts:add', input),
  removeAccount: (accountId: string) => ipcRenderer.invoke('accounts:remove', accountId),
  importAccounts: (accounts: AccountInput[]) => ipcRenderer.invoke('accounts:import', accounts),
  submitSteamGuard: (accountId: string, code: string) => ipcRenderer.invoke('accounts:steamguard', accountId, code),
  
  createTask: (input: TaskInput) => ipcRenderer.invoke('tasks:create', input),
  pauseTask: (taskId: string) => ipcRenderer.invoke('tasks:pause', taskId),
  resumeTask: (taskId: string) => ipcRenderer.invoke('tasks:resume', taskId),
  cancelTask: (taskId: string) => ipcRenderer.invoke('tasks:cancel', taskId),
  removeTask: (taskId: string) => ipcRenderer.invoke('tasks:remove', taskId),
  clearActivity: () => ipcRenderer.invoke('activity:clear'),

  // ==========================================
  // МЕТОДЫ CRM (Услуги, Заказы, Ручные задачи)
  // ==========================================
  createService: (input: Partial<Service>) => ipcRenderer.invoke('services:create', input),
  updateService: (id: string, input: Partial<Service>) => ipcRenderer.invoke('services:update', id, input),
  
  createOrder: (input: OrderInput) => ipcRenderer.invoke('orders:create', input),
  updateOrderStatus: (orderId: string, status: OrderStatus) => ipcRenderer.invoke('orders:updateStatus', orderId, status),
  assignOrder: (orderId: string, userId: string | null) => ipcRenderer.invoke('orders:assign', orderId, userId),
  
  updateManualTaskStatus: (taskId: string, status: ManualTaskStatus) => ipcRenderer.invoke('manualTasks:updateStatus', taskId, status),
  assignManualTask: (taskId: string, userId: string | null) => ipcRenderer.invoke('manualTasks:assign', taskId, userId),

  // ==========================================
  // ОБЩИЕ МЕТОДЫ (Настройки, Окна, Буфер)
  // ==========================================
  updateSettings: (settings: WorkspaceSettings) => ipcRenderer.invoke('settings:update', settings),
  
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
