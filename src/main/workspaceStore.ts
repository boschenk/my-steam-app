// -----------------------------------------------------------------------------
// Файл: src/main/workspaceStore.ts
// Описание: Хранилище состояния приложения SteamBoosted (Поддержка Ботов и CRM)
// -----------------------------------------------------------------------------

import { app } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { randomUUID } from 'crypto'
import type { WorkspaceSnapshot, ActivityLog } from '../shared/types'

export class WorkspaceStore {
  private path: string
  private snapshot: WorkspaceSnapshot
  private listener: ((snapshot: WorkspaceSnapshot) => void) | null = null

  constructor() {
    // Храним файл конфигурации в директории данных пользователя Electron
    const dataPath = app ? app.getPath('userData') : process.cwd()
    this.path = join(dataPath, 'steamboosted_store.json')
    this.snapshot = this.getEmptySnapshot()
  }

  private getEmptySnapshot(): WorkspaceSnapshot {
    return {
      // Инициализация CRM данных
      services: [
        {
          id: 's-profile-default',
          name: 'Оформление Steam Профиля',
          category: 'Steam profile services',
          description: 'Ручная настройка витрин, фонов и описания оператором.',
          price: 15.0,
          minQuantity: 1,
          maxQuantity: 1,
          estimatedDeliveryHrs: 12,
          isEnabled: true,
          requiredInputType: 'url',
          internalNotes: 'Регламент: связаться с клиентом, запросить данные оформления.',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        },
        {
          id: 's-artwork-default',
          name: 'Продвижение Иллюстраций (Рейтинг)',
          category: 'Steam artwork services',
          description: 'Организация ручных оценок операторами для вывода в топ.',
          price: 5.0,
          minQuantity: 10,
          maxQuantity: 500,
          estimatedDeliveryHrs: 24,
          isEnabled: true,
          requiredInputType: 'url',
          internalNotes: 'Проверить доступность ссылки перед назначением оператора.',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ],
      orders: [],
      manualTasks: [],
      crmActivity: [],
      users: [
        { id: 'u-admin', username: 'admin_root', role: 'admin', isActive: true, createdAt: new Date().toISOString() },
        { id: 'u-op1', username: 'operator_dan', role: 'operator', isActive: true, createdAt: new Date().toISOString() },
        { id: 'u-op2', username: 'operator_alex', role: 'operator', isActive: true, createdAt: new Date().toISOString() }
      ],
      // Инициализация данных автоматизации / аккаунтов
      accounts: [],
      tasks: [],
      activity: [],
      settings: {
        concurrency: 3,
        requestTimeoutSeconds: 12,
        itemDelayMs: 350,
        minimizeToTray: false,
        steamApiKeyConfigured: false
      }
    }
  }

  async load(): Promise<void> {
    try {
      if (existsSync(this.path)) {
        const raw = readFileSync(this.path, 'utf-8')
        const parsed = JSON.parse(raw)
        // Безопасное слияние структур на случай миграции полей
        this.snapshot = {
          ...this.getEmptySnapshot(),
          ...parsed,
          services: parsed.services?.length ? parsed.services : this.getEmptySnapshot().services,
          users: parsed.users?.length ? parsed.users : this.getEmptySnapshot().users
        }
      } else {
        this.snapshot = this.getEmptySnapshot()
        this.saveSync()
      }
    } catch (error) {
      console.error('Ошибка при загрузке хранилища SteamBoosted:', error)
      this.snapshot = this.getEmptySnapshot()
    }
  }

  private saveSync(): void {
    try {
      writeFileSync(this.path, JSON.stringify(this.snapshot, null, 2), 'utf-8')
    } catch (error) {
      console.error('Ошибка при записи хранилища SteamBoosted:', error)
    }
  }

  clone(): WorkspaceSnapshot {
    return JSON.parse(JSON.stringify(this.snapshot))
  }

  setChangeListener(callback: (snapshot: WorkspaceSnapshot) => void): void {
    this.listener = callback
  }

  async change(action: (snapshot: WorkspaceSnapshot) => void | Promise<void>): Promise<void> {
    await action(this.snapshot)
    this.saveSync()
    if (this.listener) {
      this.listener(this.clone())
    }
  }

  async addActivity(level: 'info' | 'success' | 'warning' | 'error', message: string): Promise<void> {
    await this.change((s) => {
      s.activity.unshift({
        id: randomUUID(),
        level,
        message,
        createdAt: new Date().toISOString()
      })
    })
  }

  async addCrmLog(
    userId: string | null,
    action: string,
    entityType: string,
    entityId: string | null,
    oldValue: string | null,
    newValue: string | null
  ): Promise<void> {
    await this.change((s) => {
      s.crmActivity.unshift({
        id: randomUUID(),
        userId,
        action,
        entityType,
        entityId,
        oldValue,
        newValue,
        createdAt: new Date().toISOString()
      })
    })
  }
}
