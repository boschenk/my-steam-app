import { app } from 'electron'
import { randomUUID } from 'crypto'
import { mkdir, readFile, rename, writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import type {
  ActivityEntry,
  WorkspaceSettings,
  WorkspaceSnapshot
} from '../shared/types'

const defaultSettings: WorkspaceSettings = {
  concurrency: 3,
  requestTimeoutSeconds: 12,
  itemDelayMs: 350,
  minimizeToTray: false
}

function createDefaultSnapshot(): WorkspaceSnapshot {
  return {
    accounts: [],
    tasks: [],
    activity: [
      {
        id: randomUUID(),
        level: 'info',
        message: 'Рабочее пространство готово. Добавьте публичные профили Steam.',
        createdAt: new Date().toISOString()
      }
    ],
    settings: defaultSettings
  }
}

export class WorkspaceStore {
  private readonly filePath = join(app.getPath('userData'), 'steam-desk-workspace.json')
  private snapshot: WorkspaceSnapshot = createDefaultSnapshot()
  private writeChain: Promise<void> = Promise.resolve()
  private onChange?: (snapshot: WorkspaceSnapshot) => void

  async load(): Promise<void> {
    try {
      const saved = JSON.parse(await readFile(this.filePath, 'utf8')) as Partial<WorkspaceSnapshot>
      this.snapshot = {
        accounts: Array.isArray(saved.accounts) ? saved.accounts : [],
        tasks: Array.isArray(saved.tasks) ? saved.tasks : [],
        activity: Array.isArray(saved.activity) ? saved.activity.slice(0, 300) : [],
        settings: { ...defaultSettings, ...saved.settings }
      }

      for (const task of this.snapshot.tasks) {
        if (task.status === 'running') task.status = 'queued'
        for (const item of task.items) {
          if (item.status === 'running') item.status = 'queued'
        }
      }
    } catch {
      this.snapshot = createDefaultSnapshot()
      await this.persist()
    }
  }

  setChangeListener(listener: (snapshot: WorkspaceSnapshot) => void): void {
    this.onChange = listener
  }

  peek(): WorkspaceSnapshot {
    return this.snapshot
  }

  clone(): WorkspaceSnapshot {
    return structuredClone(this.snapshot)
  }

  async change<T>(mutator: (snapshot: WorkspaceSnapshot) => T): Promise<T> {
    let result!: T
    const operation = this.writeChain.catch(() => undefined).then(async () => {
      result = mutator(this.snapshot)
      this.snapshot.activity = this.snapshot.activity.slice(0, 300)
      await this.persist()
      this.onChange?.(this.clone())
    })
    this.writeChain = operation
    await operation
    return result
  }

  async addActivity(
    level: ActivityEntry['level'],
    message: string,
    persist = true
  ): Promise<void> {
    const add = (snapshot: WorkspaceSnapshot): void => {
      snapshot.activity.unshift({
        id: randomUUID(),
        level,
        message,
        createdAt: new Date().toISOString()
      })
    }

    if (persist) {
      await this.change(add)
    } else {
      add(this.snapshot)
    }
  }

  private async persist(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true })
    const tempPath = `${this.filePath}.tmp`
    await writeFile(tempPath, JSON.stringify(this.snapshot, null, 2), 'utf8')
    await rename(tempPath, this.filePath)
  }
}
