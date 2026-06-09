// -----------------------------------------------------------------------------
// Файл: src/main/index.ts
// Описание: Главный процесс Electron (Регистрация IPC-каналов управления)
// -----------------------------------------------------------------------------

import { app, BrowserWindow, clipboard, ipcMain, shell } from 'electron'
import { randomUUID } from 'crypto'
import { join } from 'path'
import type {
  AccountInput,
  OrderInput,
  Service,
  OrderStatus,
  ManualTaskStatus,
  TaskInput,
  WorkspaceSettings,
  WorkspaceSnapshot,
  ManualTask
} from '../shared/types'
import {
  createWorkspaceTask,
  normalizeProfile,
  normalizeSteamUrl,
  TaskRunner
} from './taskRunner'
import { WorkspaceStore } from './workspaceStore'

let mainWindow: BrowserWindow | null = null
const store = new WorkspaceStore()
const runner = new TaskRunner(store)

function broadcast(snapshot: WorkspaceSnapshot): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('workspace:snapshot', snapshot)
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1420,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    autoHideMenuBar: true,
    frame: false,
    backgroundColor: '#07111f',
    title: 'SteamBoosted CRM',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void openSteamUrl(url)
    return { action: 'deny' }
  })

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

async function openSteamUrl(rawUrl: string, log = false): Promise<void> {
  const safeUrl = normalizeSteamUrl(rawUrl)
  await shell.openExternal(safeUrl)
  if (log) await store.addActivity('info', `Открыта внешняя ссылка Steam: ${safeUrl}`)
}

function registerIpc(): void {
  // Получение текущего состояния системы
  ipcMain.handle('workspace:get', () => store.clone())

  // ==========================================
  // ОБРАБОТЧИКИ: РАБОТА С АККАУНТАМИ И БОТАМИ
  // ==========================================
  
  ipcMain.handle('accounts:add', async (_event, input: AccountInput) => {
    const label = input.label.trim()
    if (!label) throw new Error('Укажите название аккаунта.')
    const normalized = normalizeProfile(input.identifier)

    await store.change((snapshot) => {
      if (snapshot.accounts.some((acc) => acc.profileUrl === normalized.profileUrl)) {
        throw new Error('Этот профиль уже добавлен.')
      }
      snapshot.accounts.unshift({
        id: randomUUID(),
        label,
        identifier: normalized.identifier,
        profileUrl: normalized.profileUrl,
        notes: input.notes?.trim() ?? '',
        status: 'unknown',
        login: input.login?.trim(),
        password: input.password?.trim(),
        sharedSecret: input.sharedSecret?.trim(),
        createdAt: new Date().toISOString()
      })
    })
    await store.addActivity('success', `Добавлен одиночный аккаунт «${label}».`)
    return store.clone()
  })

  ipcMain.handle('accounts:import', async (_event, accountsInput: AccountInput[]) => {
    if (!Array.isArray(accountsInput) || accountsInput.length === 0) {
      throw new Error('Массив аккаунтов пуст или невалиден.')
    }

    await store.change((snapshot) => {
      let importedCount = 0
      for (const item of accountsInput) {
        if (!item.login) continue
        
        // Избегаем дублирования по логину
        if (snapshot.accounts.some((acc) => acc.login === item.login)) continue

        snapshot.accounts.push({
          id: randomUUID(),
          label: item.label || item.login,
          identifier: item.identifier || item.login,
          profileUrl: `https://steamcommunity.com/id/${item.login}`,
          notes: item.notes || 'Массовый импорт',
          status: 'unknown', // Три цвета статуса: unknown/checking/available/unavailable
          login: item.login,
          password: item.password,
          sharedSecret: item.sharedSecret,
          createdAt: new Date().toISOString()
        })
        importedCount++
      }

      snapshot.activity.unshift({
        id: randomUUID(),
        level: 'success',
        message: `Успешно импортировано аккаунтов: ${importedCount}`,
        createdAt: new Date().toISOString()
      })
    })
    return store.clone()
  })

  ipcMain.handle('accounts:steamguard', async (_event, accountId: string, code: string) => {
    if (!code || code.trim().length < 5) throw new Error('Некорректный код SteamGuard.')
    
    await store.change((snapshot) => {
      const account = snapshot.accounts.find((acc) => acc.id === accountId)
      if (!account) throw new Error('Аккаунт не найден.')
      account.status = 'checking'
      account.lastError = undefined
    })
    await store.addActivity('info', `Получен код SteamGuard для аккаунта ID: ${accountId}`)
    return store.clone()
  })

  ipcMain.handle('accounts:remove', async (_event, accountId: string) => {
    await store.change((snapshot) => {
      const account = snapshot.accounts.find((entry) => entry.id === accountId)
      snapshot.accounts = snapshot.accounts.filter((entry) => entry.id !== accountId)
      if (account) {
        snapshot.activity.unshift({
          id: randomUUID(),
          level: 'warning',
          message: `Удалён аккаунт «${account.label}».`,
          createdAt: new Date().toISOString()
        })
      }
    })
    return store.clone()
  })

  ipcMain.handle('tasks:create', async (_event, input: TaskInput) => {
    let task!
    await store.change((snapshot) => {
      task = createWorkspaceTask(input, snapshot)
      snapshot.tasks.unshift(task)
    })
    await store.addActivity('info', `Создано автозадание «${task.title}» на ${task.items.length} эл.`)
    runner.kick()
    return store.clone()
  })

  ipcMain.handle('tasks:pause', async (_event, taskId: string) => {
    await store.change((snapshot) => {
      const task = snapshot.tasks.find((entry) => entry.id === taskId)
      if (task && (task.status === 'queued' || task.status === 'running')) {
        task.status = 'paused'
      }
    })
    return store.clone()
  })

  ipcMain.handle('tasks:resume', async (_event, taskId: string) => {
    await store.change((snapshot) => {
      const task = snapshot.tasks.find((entry) => entry.id === taskId)
      if (task && task.status === 'paused') {
        task.status = 'queued'
      }
    })
    runner.kick()
    return store.clone()
  })

  ipcMain.handle('tasks:cancel', async (_event, taskId: string) => {
    await store.change((snapshot) => {
      const task = snapshot.tasks.find((entry) => entry.id === taskId)
      if (task) {
        task.status = 'cancelled'
        task.items.forEach((item) => { if (item.status === 'queued') item.status = 'cancelled' })
      }
    })
    runner.cancel(taskId)
    return store.clone()
  })

  ipcMain.handle('tasks:remove', async (_event, taskId: string) => {
    await store.change((snapshot) => {
      snapshot.tasks = snapshot.tasks.filter((entry) => entry.id !== taskId)
    })
    return store.clone()
  })

  ipcMain.handle('activity:clear', async () => {
    await store.change((snapshot) => {
      snapshot.activity = []
    })
    return store.clone()
  })

  // ==========================================
  // ОБРАБОТЧИКИ: СИСТЕМА CRM (УСЛУГИ, ЗАКАЗЫ)
  // ==========================================

  ipcMain.handle('services:create', async (_event, input: Partial<Service>) => {
    if (!input.name || !input.category) throw new Error('Заполните базовые поля услуги.')
    await store.change((snapshot) => {
      snapshot.services.push({
        id: randomUUID(),
        name: input.name!,
        category: input.category!,
        description: input.description || null,
        price: input.price || 0,
        minQuantity: input.minQuantity || 1,
        maxQuantity: input.maxQuantity || 100,
        estimatedDeliveryHrs: input.estimatedDeliveryHrs || 24,
        isEnabled: true,
        requiredInputType: input.requiredInputType || 'url',
        internalNotes: input.internalNotes || null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      })
    })
    return store.clone()
  })

  ipcMain.handle('services:update', async (_event, id: string, input: Partial<Service>) => {
    await store.change((snapshot) => {
      const service = snapshot.services.find((s) => s.id === id)
      if (service) {
        Object.assign(service, input)
        service.updatedAt = new Date().toISOString()
      }
    })
    return store.clone()
  })

  ipcMain.handle('orders:create', async (_event, input: OrderInput) => {
    if (!input.publicOrderId || !input.targetUrl) throw new Error('Заполните ID заказа и ссылку.')
    
    await store.change((snapshot) => {
      const service = snapshot.services.find((s) => s.id === input.serviceId)
      if (!service) throw new Error('Указанная услуга не найдена.')

      const orderId = randomUUID()
      const newOrder = {
        id: orderId,
        publicOrderId: input.publicOrderId,
        customerEmail: input.customerEmail || null,
        serviceId: input.serviceId,
        targetUrl: normalizeSteamUrl(input.targetUrl),
        quantity: input.quantity || 1,
        status: 'pending' as OrderStatus,
        paymentStatus: 'unpaid' as const,
        assignedToId: null,
        notes: input.notes || null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        completedAt: null
      }

      // Генерация внутренней ручной задачи оператора (Без автовыполнения!)
      const manualTaskId = randomUUID()
      const newManualTask: ManualTask = {
        id: manualTaskId,
        orderId: orderId,
        title: `Выполнить: ${service.name}`,
        type: 'manual_action',
        priority: 2, // Normal
        status: 'queued' as ManualTaskStatus,
        assignedToId: null,
        targetUrl: newOrder.targetUrl,
        instructions: service.internalNotes || 'Выполнить ручные действия согласно регламенту категории.',
        checklist: JSON.stringify([{ step: 'Проверить ссылку назначения', done: false }, { step: 'Выполнить объем работы', done: false }]),
        dueAt: new Date(Date.now() + service.estimatedDeliveryHrs * 3600000).toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }

      snapshot.orders.unshift(newOrder)
      snapshot.manualTasks.unshift(newManualTask)
    })

    await store.addCrmLog(null, 'create_order', 'Order', input.publicOrderId, null, 'pending')
    return store.clone()
  })

  ipcMain.handle('orders:updateStatus', async (_event, orderId: string, status: OrderStatus) => {
    await store.change((snapshot) => {
      const order = snapshot.orders.find((o) => o.id === orderId)
      if (order) {
        const old = order.status
        order.status = status
        order.updatedAt = new Date().toISOString()
        if (status === 'completed') order.completedAt = new Date().toISOString()
        store.addCrmLog(null, 'update_order_status', 'Order', orderId, old, status)
      }
    })
    return store.clone()
  })

  ipcMain.handle('orders:assign', async (_event, orderId: string, userId: string | null) => {
    await store.change((snapshot) => {
      const order = snapshot.orders.find((o) => o.id === orderId)
      if (order) order.assignedToId = userId
    })
    return store.clone()
  })

  ipcMain.handle('manualTasks:updateStatus', async (_event, taskId: string, status: ManualTaskStatus) => {
    await store.change((snapshot) => {
      const task = snapshot.manualTasks.find((t) => t.id === taskId)
      if (task) {
        task.status = status
        task.updatedAt = new Date().toISOString()
      }
    })
    return store.clone()
  })

  ipcMain.handle('manualTasks:assign', async (_event, taskId: string, userId: string | null) => {
    await store.change((snapshot) => {
      const task = snapshot.manualTasks.find((t) => t.id === taskId)
      if (task) task.assignedToId = userId
    })
    return store.clone()
  })

  // ==========================================
  // ОБЩИЕ СИСТЕМНЫЕ ОБРАБОТЧИКИ
  // ==========================================

  ipcMain.handle('settings:update', async (_event, settings: WorkspaceSettings) => {
    const sanitized: WorkspaceSettings = {
      concurrency: Math.min(10, Math.max(1, Math.round(settings.concurrency))),
      requestTimeoutSeconds: Math.min(60, Math.max(3, Math.round(settings.requestTimeoutSeconds))),
      itemDelayMs: Math.min(5000, Math.max(100, Math.round(settings.itemDelayMs))),
      minimizeToTray: Boolean(settings.minimizeToTray),
      steamApiKeyConfigured: settings.steamApiKeyConfigured
    }
    await store.change((snapshot) => {
      snapshot.settings = sanitized
    })
    return store.clone()
  })

  ipcMain.handle('external:open', async (_event, url: string) => openSteamUrl(url, true))
  
  ipcMain.handle('clipboard:copy', async (_event, text: string) => {
    clipboard.writeText(text.slice(0, 4000))
  })

  ipcMain.handle('window:control', (_event, action: 'minimize' | 'maximize' | 'fullscreen' | 'close') => {
    if (!mainWindow) return { maximized: false, fullscreen: false }
    if (action === 'minimize') mainWindow.minimize()
    if (action === 'maximize') {
      if (mainWindow.isMaximized()) mainWindow.unmaximize()
      else mainWindow.maximize()
    }
    if (action === 'fullscreen') mainWindow.setFullScreen(!mainWindow.isFullScreen())
    if (action === 'close') mainWindow.close()
    return {
      maximized: mainWindow.isMaximized(),
      fullscreen: mainWindow.isFullScreen()
    }
  })
}

app.whenReady().then(async () => {
  app.setAppUserModelId('com.steamboosted.crm')
  await store.load()
  store.setChangeListener(broadcast)
  registerIpc()
  runner.start()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => runner.stop())
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
