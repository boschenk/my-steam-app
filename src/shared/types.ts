TypeScript
export type AccountStatus = 'unknown' | 'checking' | 'available' | 'unavailable'

export interface Account {
  id: string
  label: string
  identifier: string
  profileUrl: string
  notes: string
  status: AccountStatus
  // Добавляем новые поля
  login?: string
  password?: string
  sharedSecret?: string
  lastCheckedAt?: string
  lastError?: string
  createdAt: string
}

export type TaskKind = 'profile-check' | 'record-audit' | 'target-check'
export type TaskStatus = 'queued' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled'
export type TaskItemStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'

export interface TaskItem {
  id: string
  label: string
  accountId?: string
  status: TaskItemStatus
  error?: string
  completedAt?: string
}

export interface WorkspaceTask {
  id: string
  title: string
  kind: TaskKind
  targetUrl?: string
  status: TaskStatus
  items: TaskItem[]
  createdAt: string
  updatedAt: string
}

export interface ActivityEntry {
  id: string
  level: 'info' | 'success' | 'warning' | 'error'
  message: string
  createdAt: string
}

export interface WorkspaceSettings {
  concurrency: number
  requestTimeoutSeconds: number
  itemDelayMs: number
  minimizeToTray: boolean
}

export interface WorkspaceSnapshot {
  accounts: Account[]
  tasks: WorkspaceTask[]
  activity: ActivityEntry[]
  settings: WorkspaceSettings
}

export interface AccountInput {
  label: string
  identifier: string
  notes?: string
  // Поля для импорта
  login?: string
  password?: string
  sharedSecret?: string
}

export interface TaskInput {
  title: string
  kind: TaskKind
  accountIds?: string[]
  targetUrl?: string
}

export interface SteamDeskApi {
  getSnapshot: () => Promise<WorkspaceSnapshot>
  addAccount: (input: AccountInput) => Promise<WorkspaceSnapshot>
  removeAccount: (accountId: string) => Promise<WorkspaceSnapshot>
  createTask: (input: TaskInput) => Promise<WorkspaceSnapshot>
  pauseTask: (taskId: string) => Promise<WorkspaceSnapshot>
  resumeTask: (taskId: string) => Promise<WorkspaceSnapshot>
  cancelTask: (taskId: string) => Promise<WorkspaceSnapshot>
  removeTask: (taskId: string) => Promise<WorkspaceSnapshot>
  clearActivity: () => Promise<WorkspaceSnapshot>
  updateSettings: (settings: WorkspaceSettings) => Promise<WorkspaceSnapshot>
  openExternal: (url: string) => Promise<void>
  copyText: (text: string) => Promise<void>
  windowControl: (
    action: 'minimize' | 'maximize' | 'fullscreen' | 'close'
  ) => Promise<{ maximized: boolean; fullscreen: boolean }>
  onSnapshot: (callback: (snapshot: WorkspaceSnapshot) => void) => () => void
  importAccounts: (accounts: AccountInput[]) => Promise<WorkspaceSnapshot>
  submitSteamGuard: (accountId: string, code: string) => Promise<WorkspaceSnapshot>
}
