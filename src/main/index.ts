import { app, BrowserWindow, clipboard, ipcMain, shell } from 'electron'
import { randomUUID } from 'crypto'
import { join } from 'path'
import type {
  AccountInput,
  TaskInput,
  WorkspaceSettings,
  WorkspaceSnapshot,
  WorkspaceTask
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
    width: 1380,
    height: 860,
    minWidth: 1040,
    minHeight: 680,
    show: false,
    autoHideMenuBar: true,
    frame: false,
    backgroundColor: '#07111f',
    title: 'Steam Desk',
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
  if (log) await store.addActivity('info', `Открыта страница Steam: ${safeUrl}`)
}

function findTask(snapshot: WorkspaceSnapshot, taskId: string): WorkspaceTask {
  const task = snapshot.tasks.find((entry) => entry.id === taskId)
  if (!task) throw new Error('Задание не найдено.')
  return task
}

function registerIpc(): void {
  ipcMain.handle('workspace:get', () => store.clone())

  ipcMain.handle('accounts:add', async (_event, input: AccountInput) => {
    const label = input.label.trim()
    if (!label) throw new Error('Укажите название аккаунта.')
    const normalized = normalizeProfile(input.identifier)

    await store.change((snapshot) => {
      if (snapshot.accounts.some((account) => account.profileUrl === normalized.profileUrl)) {
        throw new Error('Этот профиль уже добавлен.')
      }
      snapshot.accounts.unshift({
        id: randomUUID(),
        label,
        identifier: normalized.identifier,
        profileUrl: normalized.profileUrl,
        notes: input.notes?.trim() ?? '',
        status: 'unknown',
        createdAt: new Date().toISOString()
      })
      snapshot.activity.unshift({
        id: randomUUID(),
        level: 'success',
        message: `Добавлен аккаунт «${label}».`,
        createdAt: new Date().toISOString()
      })
    })
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
    let task!: WorkspaceTask
    await store.change((snapshot) => {
      task = createWorkspaceTask(input, snapshot)
      snapshot.tasks.unshift(task)
      snapshot.activity.unshift({
        id: randomUUID(),
        level: 'info',
        message: `Создано задание «${task.title}» на ${task.items.length} элементов.`,
        createdAt: new Date().toISOString()
      })
    })
    runner.kick()
    return store.clone()
  })

  ipcMain.handle('tasks:pause', async (_event, taskId: string) => {
    await store.change((snapshot) => {
      const task = findTask(snapshot, taskId)
      if (task.status === 'queued' || task.status === 'running') {
        task.status = 'paused'
        task.updatedAt = new Date().toISOString()
      }
    })
    return store.clone()
  })

  ipcMain.handle('accounts:import', async (_event, accountsInput: AccountInput[]) => {
  await store.change((snapshot) => {
    let addedCount = 0;
    
    for (const input of accountsInput) {
      // Простая проверка на дубликаты по логину
      if (snapshot.accounts.some((acc) => acc.login === input.login)) {
        continue;
      }
      
      snapshot.accounts.unshift({
        id: randomUUID(),
        label: input.label || input.login || 'Без имени',
        identifier: input.identifier || input.login || '',
        profileUrl: `https://steamcommunity.com/id/${input.login}`, // Заглушка
        notes: input.notes ?? '',
        status: 'checking', // Ставим статус "В процессе" (Оранжевый) при добавлении
        login: input.login,
        password: input.password,
        sharedSecret: input.sharedSecret,
        createdAt: new Date().toISOString()
      });
      addedCount++;
    }

    snapshot.activity.unshift({
      id: randomUUID(),
      level: 'success',
      message: `Массовый импорт завершен. Добавлено аккаунтов: ${addedCount}.`,
      createdAt: new Date().toISOString()
    });
  });
  
  // Здесь вы можете вызвать метод вашего TaskRunner для автоматического запуска логина этих аккаунтов через steam-user
  
  return store.clone();
});
  
  ipcMain.handle('tasks:resume', async (_event, taskId: string) => {
    await store.change((snapshot) => {
      const task = findTask(snapshot, taskId)
      if (task.status === 'paused') {
        task.status = 'queued'
        task.updatedAt = new Date().toISOString()
      }
    })
    runner.kick()
    return store.clone()
  })

  ipcMain.handle('tasks:cancel', async (_event, taskId: string) => {
    await store.change((snapshot) => {
      const task = findTask(snapshot, taskId)
      task.status = 'cancelled'
      task.updatedAt = new Date().toISOString()
      for (const item of task.items) {
        if (item.status === 'queued') item.status = 'cancelled'
      }
    })
    runner.cancel(taskId)
    return store.clone()
  })

  ipcMain.handle('tasks:remove', async (_event, taskId: string) => {
    await store.change((snapshot) => {
      const task = findTask(snapshot, taskId)
      if (task.status === 'running' || task.status === 'queued') {
        throw new Error('Сначала завершите или отмените задание.')
      }
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

  ipcMain.handle('settings:update', async (_event, settings: WorkspaceSettings) => {
    const sanitized: WorkspaceSettings = {
      concurrency: Math.min(10, Math.max(1, Math.round(settings.concurrency))),
      requestTimeoutSeconds: Math.min(
        60,
        Math.max(3, Math.round(settings.requestTimeoutSeconds))
      ),
      itemDelayMs: Math.min(5000, Math.max(100, Math.round(settings.itemDelayMs))),
      minimizeToTray: Boolean(settings.minimizeToTray)
    }
    await store.change((snapshot) => {
      snapshot.settings = sanitized
      snapshot.activity.unshift({
        id: randomUUID(),
        level: 'success',
        message: 'Настройки сохранены.',
        createdAt: new Date().toISOString()
      })
    })
    runner.kick()
    return store.clone()
  })

  ipcMain.handle('external:open', async (_event, url: string) => openSteamUrl(url, true))
  ipcMain.handle('clipboard:copy', async (_event, text: string) => {
    clipboard.writeText(text.slice(0, 4000))
    await store.addActivity('success', 'Текст комментария скопирован в буфер обмена.')
  })
  ipcMain.handle(
    'window:control',
    (
      _event,
      action: 'minimize' | 'maximize' | 'fullscreen' | 'close'
    ): { maximized: boolean; fullscreen: boolean } => {
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
    }
  )
}

app.whenReady().then(async () => {
  app.setAppUserModelId('com.steamdesk.app')

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
