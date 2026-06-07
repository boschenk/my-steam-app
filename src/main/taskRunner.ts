import { randomUUID } from 'crypto'
import type {
  TaskInput,
  TaskItem,
  TaskKind,
  WorkspaceSnapshot,
  WorkspaceTask
} from '../shared/types'
import { WorkspaceStore } from './workspaceStore'

const allowedSteamHosts = new Set([
  'steamcommunity.com',
  'www.steamcommunity.com',
  'store.steampowered.com',
  'help.steampowered.com'
])

export function normalizeProfile(identifier: string): { identifier: string; profileUrl: string } {
  const value = identifier.trim()
  if (!value) throw new Error('Укажите SteamID, vanity ID или ссылку на профиль.')

  if (/^\d{17}$/.test(value)) {
    return {
      identifier: value,
      profileUrl: `https://steamcommunity.com/profiles/${value}`
    }
  }

  if (/^[a-zA-Z0-9_-]{2,64}$/.test(value)) {
    return {
      identifier: value,
      profileUrl: `https://steamcommunity.com/id/${value}`
    }
  }

  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('Не удалось распознать профиль Steam.')
  }

  if (url.protocol !== 'https:' || !allowedSteamHosts.has(url.hostname.toLowerCase())) {
    throw new Error('Разрешены только HTTPS-ссылки на официальные домены Steam.')
  }

  if (!/^\/(id|profiles)\/[^/]+\/?$/i.test(url.pathname)) {
    throw new Error('Ссылка должна вести на профиль steamcommunity.com/id/... или /profiles/...')
  }

  url.search = ''
  url.hash = ''
  return { identifier: value, profileUrl: url.toString().replace(/\/$/, '') }
}

export function normalizeSteamUrl(rawUrl: string): string {
  let url: URL
  try {
    url = new URL(rawUrl.trim())
  } catch {
    throw new Error('Укажите корректную HTTPS-ссылку Steam.')
  }

  if (url.protocol !== 'https:' || !allowedSteamHosts.has(url.hostname.toLowerCase())) {
    throw new Error('Разрешены только HTTPS-ссылки на официальные домены Steam.')
  }

  return url.toString()
}

function taskKindLabel(kind: TaskKind): string {
  if (kind === 'profile-check') return 'Проверка профилей'
  if (kind === 'record-audit') return 'Аудит записей'
  return 'Проверка целевой страницы'
}

export function createWorkspaceTask(input: TaskInput, snapshot: WorkspaceSnapshot): WorkspaceTask {
  const now = new Date().toISOString()
  const title = input.title.trim() || taskKindLabel(input.kind)
  let items: TaskItem[] = []
  let targetUrl: string | undefined

  if (input.kind === 'target-check') {
    targetUrl = normalizeSteamUrl(input.targetUrl ?? '')
    items = [
      {
        id: randomUUID(),
        label: targetUrl,
        status: 'queued'
      }
    ]
  } else {
    const selected = new Set(input.accountIds ?? [])
    const accounts = snapshot.accounts.filter((account) => selected.has(account.id))
    if (accounts.length === 0) throw new Error('Выберите хотя бы один аккаунт.')
    items = accounts.map((account) => ({
      id: randomUUID(),
      accountId: account.id,
      label: account.label,
      status: 'queued'
    }))
  }

  return {
    id: randomUUID(),
    title,
    kind: input.kind,
    targetUrl,
    status: 'queued',
    items,
    createdAt: now,
    updatedAt: now
  }
}

export class TaskRunner {
  private activeCount = 0
  private scheduling = false
  private timer?: NodeJS.Timeout
  private controllers = new Map<string, AbortController>()

  constructor(private readonly store: WorkspaceStore) {}

  start(): void {
    this.timer = setInterval(() => void this.schedule(), 500)
    void this.schedule()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    for (const controller of this.controllers.values()) controller.abort()
  }

  kick(): void {
    void this.schedule()
  }

  cancel(taskId: string): void {
    for (const [key, controller] of this.controllers) {
      if (key.startsWith(`${taskId}:`)) controller.abort()
    }
  }

  private async schedule(): Promise<void> {
    if (this.scheduling) return
    this.scheduling = true

    try {
      while (this.activeCount < this.store.peek().settings.concurrency) {
        const candidate = this.findCandidate()
        if (!candidate) break

        await this.store.change((snapshot) => {
          const task = snapshot.tasks.find((entry) => entry.id === candidate.taskId)
          const item = task?.items.find((entry) => entry.id === candidate.itemId)
          if (!task || !item || item.status !== 'queued') return
          task.status = 'running'
          task.updatedAt = new Date().toISOString()
          item.status = 'running'
        })

        this.activeCount += 1
        void this.execute(candidate.taskId, candidate.itemId).finally(() => {
          this.activeCount -= 1
          void this.schedule()
        })
      }
    } finally {
      this.scheduling = false
    }
  }

  private findCandidate(): { taskId: string; itemId: string } | undefined {
    for (const task of this.store.peek().tasks) {
      if (task.status !== 'queued' && task.status !== 'running') continue
      const item = task.items.find((entry) => entry.status === 'queued')
      if (item) return { taskId: task.id, itemId: item.id }
    }
    return undefined
  }

  private async execute(taskId: string, itemId: string): Promise<void> {
    const snapshot = this.store.peek()
    const task = snapshot.tasks.find((entry) => entry.id === taskId)
    const item = task?.items.find((entry) => entry.id === itemId)
    if (!task || !item) return

    const controller = new AbortController()
    const controllerKey = `${taskId}:${itemId}`
    this.controllers.set(controllerKey, controller)

    try {
      await this.delay(snapshot.settings.itemDelayMs, controller.signal)

      if (task.kind === 'profile-check') {
        const account = snapshot.accounts.find((entry) => entry.id === item.accountId)
        if (!account) throw new Error('Аккаунт больше не существует.')
        await this.setAccountChecking(account.id)
        await this.checkPublicUrl(account.profileUrl, controller)
        await this.finishAccountCheck(account.id, true)
      } else if (task.kind === 'record-audit') {
        const account = snapshot.accounts.find((entry) => entry.id === item.accountId)
        if (!account) throw new Error('Аккаунт больше не существует.')
        normalizeProfile(account.profileUrl)
      } else if (task.targetUrl) {
        await this.checkPublicUrl(task.targetUrl, controller)
      }

      await this.finishItem(taskId, itemId, true)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (task.kind === 'profile-check' && item.accountId && message !== 'Операция отменена.') {
        await this.finishAccountCheck(item.accountId, false, message)
      }
      await this.finishItem(taskId, itemId, false, message)
    } finally {
      this.controllers.delete(controllerKey)
    }
  }

  private async checkPublicUrl(url: string, controller: AbortController): Promise<void> {
    const timeoutMs = this.store.peek().settings.requestTimeoutSeconds * 1000
    const timeout = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const response = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,
        headers: { 'user-agent': 'Steam Desk/1.0 public profile checker' }
      })
      await response.body?.cancel()
      if (response.status >= 500) throw new Error(`Steam ответил кодом ${response.status}.`)
    } catch (error) {
      if (controller.signal.aborted) throw new Error('Операция отменена.')
      throw error
    } finally {
      clearTimeout(timeout)
    }
  }

  private async setAccountChecking(accountId: string): Promise<void> {
    await this.store.change((snapshot) => {
      const account = snapshot.accounts.find((entry) => entry.id === accountId)
      if (account) {
        account.status = 'checking'
        account.lastError = undefined
      }
    })
  }

  private async finishAccountCheck(
    accountId: string,
    success: boolean,
    error?: string
  ): Promise<void> {
    await this.store.change((snapshot) => {
      const account = snapshot.accounts.find((entry) => entry.id === accountId)
      if (!account) return
      account.status = success ? 'available' : 'unavailable'
      account.lastCheckedAt = new Date().toISOString()
      account.lastError = error
    })
  }

  private async finishItem(
    taskId: string,
    itemId: string,
    success: boolean,
    error?: string
  ): Promise<void> {
    let logMessage = ''
    let logLevel: 'success' | 'warning' | 'error' = success ? 'success' : 'error'

    await this.store.change((snapshot) => {
      const task = snapshot.tasks.find((entry) => entry.id === taskId)
      const item = task?.items.find((entry) => entry.id === itemId)
      if (!task || !item) return

      if (task.status === 'cancelled' || error === 'Операция отменена.') {
        item.status = 'cancelled'
        logMessage = `Отменено: ${task.title} / ${item.label}`
        logLevel = 'warning'
      } else {
        item.status = success ? 'completed' : 'failed'
        item.error = error
        item.completedAt = new Date().toISOString()
        logMessage = success
          ? `Готово: ${task.title} / ${item.label}`
          : `Ошибка: ${task.title} / ${item.label}: ${error}`
      }

      const hasQueued = task.items.some((entry) =>
        ['queued', 'running'].includes(entry.status)
      )
      if (!hasQueued && task.status !== 'cancelled') {
        task.status = task.items.some((entry) => entry.status === 'failed')
          ? 'failed'
          : 'completed'
      }
      task.updatedAt = new Date().toISOString()

      if (logMessage) {
        snapshot.activity.unshift({
          id: randomUUID(),
          level: logLevel,
          message: logMessage,
          createdAt: new Date().toISOString()
        })
      }
    })
  }

  private delay(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, ms)
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timer)
          reject(new Error('Операция отменена.'))
        },
        { once: true }
      )
    })
  }
}
