import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import {
  Activity,
  CheckCircle2,
  ChevronRight,
  CircleUserRound,
  Clipboard,
  Clock3,
  Compass,
  Download,
  Edit3,
  FileSpreadsheet,
  ExternalLink,
  FileCheck2,
  FileUp,
  Gauge,
  Heart,
  KeyRound,
  LayoutDashboard,
  ListTodo,
  LockKeyhole,
  Maximize2,
  Menu,
  MessageSquare,
  Minus,
  Pause,
  Play,
  Power,
  Plus,
  RefreshCw,
  RotateCcw,
  SearchCheck,
  Settings,
  ShieldCheck,
  Star,
  Trash2,
  UserPlus,
  Users,
  X
} from 'lucide-react'
import type {
  Account,
  TaskKind,
  WorkspaceSettings,
  WorkspaceSnapshot,
  WorkspaceTask
} from '../../shared/types'

type Page = 'dashboard' | 'accounts' | 'tasks' | 'activity' | 'settings'

const emptySnapshot: WorkspaceSnapshot = {
  accounts: [],
  tasks: [],
  activity: [],
  settings: {
    concurrency: 3,
    requestTimeoutSeconds: 12,
    itemDelayMs: 350,
    minimizeToTray: false
  }
}

const navItems: Array<{
  id: string
  page: Page
  label: string
  icon: typeof LayoutDashboard
}> = [
  { id: 'nav-dashboard', page: 'dashboard', label: 'Обзор', icon: LayoutDashboard },
  { id: 'nav-accounts', page: 'accounts', label: 'Аккаунты', icon: CircleUserRound },
  { id: 'nav-tasks', page: 'tasks', label: 'Задания', icon: ListTodo },
  { id: 'nav-activity', page: 'activity', label: 'Журнал', icon: Activity },
  { id: 'nav-settings', page: 'settings', label: 'Настройки', icon: Settings }
]

const actionButtons = [
  {
    id: 'action-like',
    label: 'Поставить лайк',
    description: 'Открыть иллюстрацию, скриншот или запись',
    icon: Heart,
    color: 'rose'
  },
  {
    id: 'action-favorite',
    label: 'В избранное',
    description: 'Открыть страницу элемента Мастерской',
    icon: Star,
    color: 'amber'
  },
  {
    id: 'action-subscribe-workshop',
    label: 'Подписаться',
    description: 'Перейти к подписке на элемент Мастерской',
    icon: UserPlus,
    color: 'blue'
  },
  {
    id: 'action-comment',
    label: 'Комментарий',
    description: 'Скопировать текст и открыть страницу',
    icon: MessageSquare,
    color: 'violet'
  },
  {
    id: 'action-join-group',
    label: 'Вступить в группу',
    description: 'Открыть страницу сообщества Steam',
    icon: Users,
    color: 'cyan'
  },
  {
    id: 'action-follow-curator',
    label: 'Подписаться на куратора',
    description: 'Открыть страницу куратора или автора',
    icon: Compass,
    color: 'green'
  }
] as const

function formatDate(value?: string): string {
  if (!value) return 'Ещё не проверялся'
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(value))
}

function taskProgress(task: WorkspaceTask): number {
  if (task.items.length === 0) return 0
  const done = task.items.filter((item) =>
    ['completed', 'failed', 'cancelled'].includes(item.status)
  ).length
  return Math.round((done / task.items.length) * 100)
}

function taskStatusLabel(task: WorkspaceTask): string {
  const labels: Record<WorkspaceTask['status'], string> = {
    queued: 'В очереди',
    running: 'Выполняется',
    paused: 'На паузе',
    completed: 'Готово',
    failed: 'Есть ошибки',
    cancelled: 'Отменено'
  }
  return labels[task.status]
}

function App(): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot>(emptySnapshot)
  const [page, setPage] = useState<Page>('dashboard')
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [loading, setLoading] = useState('api' in window)
  const [busy, setBusy] = useState<string>()
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string }>()
  const [accountFormOpen, setAccountFormOpen] = useState(false)
  const [importFormOpen, setImportFormOpen] = useState(false)
  const [editingAccount, setEditingAccount] = useState<Account>()
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>([])
  const [taskFormOpen, setTaskFormOpen] = useState(false)
  const [targetUrl, setTargetUrl] = useState('')
  const [importText, setImportText] = useState('')
  const [commentText, setCommentText] = useState('')
  const [settingsDraft, setSettingsDraft] = useState<WorkspaceSettings>(
    emptySnapshot.settings
  )

  const showError = useCallback((error: unknown): void => {
    const raw = error instanceof Error ? error.message : String(error)
    const text = raw.replace(/^Error invoking remote method '[^']+': Error:\s*/, '')
    setNotice({ tone: 'error', text })
  }, [])

  const account = snapshot.accounts[0]
  const activeTasks = snapshot.tasks.filter((task) =>
    ['queued', 'running', 'paused'].includes(task.status)
  )
  const completedTasks = snapshot.tasks.filter((task) => task.status === 'completed')
  const availableAccount = account?.status === 'available'

  useEffect(() => {
    let mounted = true
    if (!('api' in window)) {
      return () => {
        mounted = false
      }
    }

    void window.api
      .getSnapshot()
      .then((value) => {
        if (mounted) {
          setSnapshot(value)
          setSettingsDraft(value.settings)
        }
      })
      .catch((error) => showError(error))
      .finally(() => setLoading(false))

    const unsubscribe = window.api.onSnapshot((value) => {
      setSnapshot(value)
      setSettingsDraft(value.settings)
    })
    return () => {
      mounted = false
      unsubscribe()
    }
  }, [showError])

  const recentTasks = useMemo(() => snapshot.tasks.slice(0, 4), [snapshot.tasks])

  async function run(id: string, action: () => Promise<WorkspaceSnapshot | void>): Promise<void> {
    setBusy(id)
    setNotice(undefined)
    try {
      const value = await action()
      if (value) setSnapshot(value)
    } catch (error) {
      showError(error)
    } finally {
      setBusy(undefined)
    }
  }

  async function submitAccount(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    await run('account-add-submit', async () => {
      const value = await window.api.addAccount({
        label: String(form.get('label') ?? ''),
        identifier: String(form.get('identifier') ?? ''),
        notes: String(form.get('notes') ?? '')
      })
      setAccountFormOpen(false)
      setNotice({ tone: 'ok', text: 'Аккаунт добавлен.' })
      return value
    })
  }

  async function createProfileCheck(): Promise<void> {
    if (!account) {
      setAccountFormOpen(true)
      return
    }
    await run('account-check-now', async () => {
      const value = await window.api.createTask({
        title: `Проверка ${account.label}`,
        kind: 'profile-check',
        accountIds: [account.id]
      })
      setNotice({ tone: 'ok', text: 'Проверка добавлена в очередь.' })
      return value
    })
  }

  async function createAccountChecks(accountIds: string[]): Promise<void> {
    if (accountIds.length === 0) {
      setNotice({ tone: 'error', text: 'Выберите хотя бы один аккаунт.' })
      return
    }
    await run('accounts-check-selected', async () => {
      const value = await window.api.createTask({
        title: `Проверка аккаунтов (${accountIds.length})`,
        kind: 'profile-check',
        accountIds
      })
      setNotice({ tone: 'ok', text: 'Публичная проверка добавлена в очередь.' })
      return value
    })
  }

  function showDisconnected(feature: string): void {
    setNotice({
      tone: 'error',
      text: `${feature}: UI готов, но обработчик учётных данных не подключён.`
    })
  }

  function toggleAccount(accountId: string): void {
    setSelectedAccountIds((current) =>
      current.includes(accountId)
        ? current.filter((id) => id !== accountId)
        : [...current, accountId]
    )
  }

  function toggleAllAccounts(): void {
    setSelectedAccountIds((current) =>
      current.length === snapshot.accounts.length
        ? []
        : snapshot.accounts.map((entry) => entry.id)
    )
  }

  async function submitTask(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const kind = String(form.get('kind')) as TaskKind
    await run('task-create-submit', async () => {
      const value = await window.api.createTask({
        title: String(form.get('title') ?? ''),
        kind,
        accountIds: account ? [account.id] : [],
        targetUrl: String(form.get('targetUrl') ?? '')
      })
      setTaskFormOpen(false)
      setNotice({ tone: 'ok', text: 'Задание создано и запущено.' })
      return value
    })
  }

  async function performAction(actionId: string): Promise<void> {
    if (!account) {
      setAccountFormOpen(true)
      setNotice({ tone: 'error', text: 'Сначала добавьте свой Steam-аккаунт.' })
      return
    }
    if (!targetUrl.trim()) {
      setNotice({ tone: 'error', text: 'Вставьте ссылку на страницу Steam.' })
      return
    }
    await run(actionId, async () => {
      if (actionId === 'action-comment' && commentText.trim()) {
        await window.api.copyText(commentText.trim())
      }
      const value = await window.api.createTask({
        title: `Проверка цели: ${actionButtons.find((item) => item.id === actionId)?.label ?? 'Steam'}`,
        kind: 'target-check',
        targetUrl: targetUrl.trim()
      })
      setNotice({
        tone: 'error',
        text: 'Страница проверена, но действие не отправлено: официальный Steam API для этой команды отсутствует.'
      })
      return value
    })
  }

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="brand-mark large">
          <Gauge size={30} />
        </div>
        <div className="loading-line" />
        <span>Запускаем Steam Desk</span>
      </div>
    )
  }

  return (
    <div className={`app-shell ${sidebarOpen ? '' : 'sidebar-collapsed'}`}>
      <header className="titlebar">
        <div className="titlebar-drag">
          <div className="titlebar-brand">
            <div className="brand-mark">
              <Gauge size={18} />
            </div>
            <span>Steam Desk</span>
            <span className="version-pill">1.1</span>
          </div>
        </div>
        <div className="window-controls">
          <button
            id="window-minimize"
            aria-label="Свернуть"
            onClick={() => void window.api.windowControl('minimize')}
          >
            <Minus size={16} />
          </button>
          <button
            id="window-maximize"
            aria-label="Развернуть"
            onClick={() => void window.api.windowControl('maximize')}
          >
            <Maximize2 size={14} />
          </button>
          <button
            id="window-close"
            className="close"
            aria-label="Закрыть"
            onClick={() => void window.api.windowControl('close')}
          >
            <X size={16} />
          </button>
        </div>
      </header>

      <aside className="sidebar">
        <div className="sidebar-top">
          <button
            id="sidebar-toggle"
            className="icon-button"
            aria-label="Свернуть меню"
            onClick={() => setSidebarOpen((value) => !value)}
          >
            <Menu size={20} />
          </button>
        </div>
        <nav className="navigation">
          {navItems.map((item) => {
            const Icon = item.icon
            return (
              <button
                id={item.id}
                key={item.page}
                className={page === item.page ? 'active' : ''}
                title={item.label}
                onClick={() => setPage(item.page)}
              >
                <Icon size={19} />
                <span>{item.label}</span>
              </button>
            )
          })}
        </nav>
        <div className="sidebar-account">
          <div className={`account-avatar ${availableAccount ? 'online' : ''}`}>
            {account?.label.slice(0, 1).toUpperCase() ?? '?'}
          </div>
          <div>
            <strong>{account?.label ?? 'Аккаунт не добавлен'}</strong>
            <span>{availableAccount ? 'Профиль доступен' : 'Локальный режим'}</span>
          </div>
        </div>
      </aside>

      <main className="content">
        {notice && (
          <div className={`notice ${notice.tone}`}>
            {notice.tone === 'ok' ? <CheckCircle2 size={18} /> : <ShieldCheck size={18} />}
            <span>{notice.text}</span>
            <button aria-label="Закрыть уведомление" onClick={() => setNotice(undefined)}>
              <X size={16} />
            </button>
          </div>
        )}

        {page === 'dashboard' && (
          <Dashboard
            account={account}
            availableAccount={availableAccount}
            activeCount={activeTasks.length}
            completedCount={completedTasks.length}
            recentTasks={recentTasks}
            targetUrl={targetUrl}
            commentText={commentText}
            busy={busy}
            onTargetChange={setTargetUrl}
            onCommentChange={setCommentText}
            onAction={(id) => void performAction(id)}
            onAddAccount={() => setAccountFormOpen(true)}
            onCheck={() => void createProfileCheck()}
            onOpenTasks={() => setPage('tasks')}
          />
        )}

        {page === 'accounts' && (
          <AccountsPage
            accounts={snapshot.accounts}
            selectedIds={selectedAccountIds}
            busy={busy}
            onAdd={() => setAccountFormOpen(true)}
            onImport={() => setImportFormOpen(true)}
            onExport={(format) => showDisconnected(`Экспорт ${format.toUpperCase()}`)}
            onToggle={toggleAccount}
            onToggleAll={toggleAllAccounts}
            onCheck={() => void createAccountChecks(selectedAccountIds)}
            onStart={() => showDisconnected('Запуск выбранных аккаунтов')}
            onStartAll={() => showDisconnected('Запуск всех аккаунтов')}
            onStop={() => showDisconnected('Остановка выбранных аккаунтов')}
            onEdit={setEditingAccount}
            onRestart={(entry) => showDisconnected(`Перезапуск «${entry.label}»`)}
            onOpen={(entry) => void window.api.openExternal(entry.profileUrl)}
            onRemove={(entry) =>
              void run(`account-remove-${entry.id}`, () => window.api.removeAccount(entry.id))
            }
          />
        )}

        {page === 'tasks' && (
          <TasksPage
            tasks={snapshot.tasks}
            busy={busy}
            onCreate={() => setTaskFormOpen(true)}
            onPause={(id) => void run(`pause-${id}`, () => window.api.pauseTask(id))}
            onResume={(id) => void run(`resume-${id}`, () => window.api.resumeTask(id))}
            onCancel={(id) => void run(`cancel-${id}`, () => window.api.cancelTask(id))}
            onRemove={(id) => void run(`remove-${id}`, () => window.api.removeTask(id))}
          />
        )}

        {page === 'activity' && (
          <ActivityPage
            entries={snapshot.activity}
            onClear={() => void run('activity-clear', () => window.api.clearActivity())}
          />
        )}

        {page === 'settings' && (
          <SettingsPage
            settings={settingsDraft}
            busy={busy}
            onChange={setSettingsDraft}
            onSave={() =>
              void run('settings-save', () => window.api.updateSettings(settingsDraft))
            }
            onFullscreen={() => void window.api.windowControl('fullscreen')}
          />
        )}
      </main>

      {accountFormOpen && (
        <Modal title="Добавить личный аккаунт" onClose={() => setAccountFormOpen(false)}>
          <form className="form-stack" onSubmit={(event) => void submitAccount(event)}>
            <div className="security-note">
              <ShieldCheck size={20} />
              <p>
                Поля доступа ниже добавлены как UI-макет. Приложение сохраняет только название,
                публичный SteamID/ссылку и заметку.
              </p>
            </div>
            <label>
              Название
              <input
                id="account-label-input"
                name="label"
                placeholder="Мой основной аккаунт"
                autoFocus
                required
              />
            </label>
            <label>
              SteamID или ссылка
              <input
                id="account-identifier-input"
                name="identifier"
                placeholder="7656119... или steamcommunity.com/id/..."
                required
              />
            </label>
            <div className="credential-demo-grid">
              <label>
                Логин
                <input
                  id="account-login-input"
                  name="login-ui-only"
                  placeholder="Логин Steam"
                  autoComplete="off"
                />
              </label>
              <label>
                Пароль
                <input
                  id="account-password-input"
                  name="password-ui-only"
                  type="password"
                  placeholder="Не сохраняется"
                  autoComplete="new-password"
                />
              </label>
            </div>
            <label>
              Shared secret
              <div className="inline-field-action">
                <input
                  id="account-shared-secret-input"
                  name="shared-secret-ui-only"
                  type="password"
                  placeholder="UI-поле, не сохраняется"
                  autoComplete="off"
                />
                <button
                  id="account-create-shared-secret"
                  type="button"
                  className="button ghost compact"
                  onClick={() => showDisconnected('Создание shared secret')}
                >
                  <KeyRound size={15} />
                  Создать
                </button>
              </div>
            </label>
            <label>
              Заметка
              <textarea
                id="account-notes-input"
                name="notes"
                rows={3}
                placeholder="Необязательно"
              />
            </label>
            <div className="modal-actions">
              <button
                id="account-add-cancel"
                type="button"
                className="button ghost"
                onClick={() => setAccountFormOpen(false)}
              >
                Отмена
              </button>
              <button
                id="account-add-submit"
                className="button primary"
                disabled={busy === 'account-add-submit'}
              >
                <Plus size={17} />
                Добавить
              </button>
            </div>
          </form>
        </Modal>
      )}

      {importFormOpen && (
        <Modal title="Импорт аккаунтов" onClose={() => setImportFormOpen(false)}>
          <div className="form-stack">
            <div className="security-note warning">
              <LockKeyhole size={20} />
              <p>
                Это только интерфейс импорта. Файл и введённый текст не читаются и не
                сохраняются текущей версией приложения.
              </p>
            </div>
            <label>
              Файл TXT, CSV или Excel
              <input
                id="accounts-import-file"
                type="file"
                accept=".txt,.csv,.xlsx,.xls"
              />
            </label>
            <label>
              Или вставьте список
              <textarea
                id="accounts-import-text"
                rows={8}
                placeholder={'login:password\nlogin:password:shared_secret'}
                autoComplete="off"
              />
            </label>
            <div className="format-preview">
              <code>login:password</code>
              <code>login:password:shared_secret</code>
            </div>
            <div className="modal-actions">
              <button
                id="accounts-import-cancel"
                type="button"
                className="button ghost"
                onClick={() => setImportFormOpen(false)}
              >
                Отмена
              </button>
              <button
                id="accounts-import-submit"
                type="button"
                className="button primary"
                onClick={() => {
                  setImportFormOpen(false)
                  showDisconnected('Импорт аккаунтов')
                }}
              >
                <FileUp size={17} />
                Импортировать
              </button>
            </div>
          </div>
        </Modal>
      )}

      {editingAccount && (
        <Modal title={`Редактировать: ${editingAccount.label}`} onClose={() => setEditingAccount(undefined)}>
          <div className="form-stack">
            <div className="security-note warning">
              <LockKeyhole size={20} />
              <p>
                Логин, пароль и shared secret представлены только визуально и не передаются в
                фоновый процесс.
              </p>
            </div>
            <label>
              Логин
              <input
                id="account-edit-login"
                defaultValue={editingAccount.label}
                autoComplete="off"
              />
            </label>
            <label>
              Новый пароль
              <input
                id="account-edit-password"
                type="password"
                placeholder="Введите новый пароль"
                autoComplete="new-password"
              />
            </label>
            <label>
              Shared secret
              <div className="inline-field-action">
                <input
                  id="account-edit-shared-secret"
                  type="password"
                  placeholder="Вставьте shared secret"
                  autoComplete="off"
                />
                <button
                  id="account-edit-create-shared-secret"
                  type="button"
                  className="button ghost compact"
                  onClick={() => showDisconnected('Создание shared secret')}
                >
                  <KeyRound size={15} />
                  Создать
                </button>
              </div>
            </label>
            <div className="modal-actions split">
              <button
                id="account-edit-relogin"
                type="button"
                className="button ghost"
                onClick={() => showDisconnected('Повторный вход')}
              >
                <RotateCcw size={16} />
                Перезайти
              </button>
              <div>
                <button
                  id="account-edit-cancel"
                  type="button"
                  className="button ghost"
                  onClick={() => setEditingAccount(undefined)}
                >
                  Отмена
                </button>
                <button
                  id="account-edit-save"
                  type="button"
                  className="button primary"
                  onClick={() => {
                    setEditingAccount(undefined)
                    showDisconnected('Сохранение учётных данных')
                  }}
                >
                  Сохранить
                </button>
              </div>
            </div>
          </div>
        </Modal>
      )}

      {taskFormOpen && (
        <Modal title="Новое задание" onClose={() => setTaskFormOpen(false)}>
          <form className="form-stack" onSubmit={(event) => void submitTask(event)}>
            <label>
              Название
              <input id="task-title-input" name="title" placeholder="Проверка профиля" />
            </label>
            <label>
              Тип задания
              <select id="task-kind-select" name="kind" defaultValue="profile-check">
                <option value="profile-check">Проверить доступность профиля</option>
                <option value="record-audit">Проверить локальную запись</option>
                <option value="target-check">Проверить страницу Steam</option>
              </select>
            </label>
            <label>
              Целевая ссылка
              <input
                id="task-target-input"
                name="targetUrl"
                placeholder="Нужна только для проверки страницы"
              />
            </label>
            <div className="modal-actions">
              <button
                id="task-create-cancel"
                type="button"
                className="button ghost"
                onClick={() => setTaskFormOpen(false)}
              >
                Отмена
              </button>
              <button
                id="task-create-submit"
                className="button primary"
                disabled={busy === 'task-create-submit'}
              >
                <Play size={17} />
                Создать
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  )
}

interface DashboardProps {
  account: WorkspaceSnapshot['accounts'][number] | undefined
  availableAccount: boolean
  activeCount: number
  completedCount: number
  recentTasks: WorkspaceTask[]
  targetUrl: string
  commentText: string
  busy?: string
  onTargetChange: (value: string) => void
  onCommentChange: (value: string) => void
  onAction: (id: string) => void
  onAddAccount: () => void
  onCheck: () => void
  onOpenTasks: () => void
}

function Dashboard(props: DashboardProps): React.JSX.Element {
  return (
    <div className="page">
      <section className="page-heading">
        <div>
          <span className="eyebrow">Личная панель</span>
          <h1>Добрый день{props.account ? `, ${props.account.label}` : ''}</h1>
          <p>Управляйте одним аккаунтом и подключайте только официальные методы Steam.</p>
        </div>
        <div className="heading-actions">
          <button id="dashboard-open-tasks" className="button ghost" onClick={props.onOpenTasks}>
            <ListTodo size={17} />
            Все задания
          </button>
          <button
            id="window-fullscreen"
            className="button ghost square"
            title="Полноэкранный режим"
            onClick={() => void window.api.windowControl('fullscreen')}
          >
            <Maximize2 size={18} />
          </button>
        </div>
      </section>

      <section className="hero-grid">
        <article className="account-hero">
          <div className="account-hero-glow" />
          <div className="hero-status">
            <span className={`status-dot ${props.availableAccount ? 'online' : ''}`} />
            {props.availableAccount ? 'Профиль доступен' : 'Требуется проверка'}
          </div>
          <div className="hero-avatar">
            {props.account?.label.slice(0, 1).toUpperCase() ?? <CircleUserRound size={38} />}
          </div>
          <div className="hero-copy">
            <span>Активный аккаунт</span>
            <h2>{props.account?.label ?? 'Добавьте свой Steam-профиль'}</h2>
            <p>
              {props.account?.profileUrl ??
                'Приложение не запрашивает логин, пароль или Steam Guard.'}
            </p>
          </div>
          {props.account ? (
            <button
              id="account-check-now"
              className="button light"
              disabled={props.busy === 'account-check-now'}
              onClick={props.onCheck}
            >
              <RefreshCw size={17} />
              Проверить
            </button>
          ) : (
            <button id="dashboard-add-account" className="button light" onClick={props.onAddAccount}>
              <Plus size={17} />
              Добавить аккаунт
            </button>
          )}
        </article>

        <div className="stats-grid">
          <article className="stat-card">
            <div className="stat-icon blue">
              <Activity size={20} />
            </div>
            <div>
              <strong>{props.activeCount}</strong>
              <span>Активных заданий</span>
            </div>
          </article>
          <article className="stat-card">
            <div className="stat-icon green">
              <CheckCircle2 size={20} />
            </div>
            <div>
              <strong>{props.completedCount}</strong>
              <span>Завершено</span>
            </div>
          </article>
          <article className="stat-card wide">
            <div className="stat-icon violet">
              <ShieldCheck size={20} />
            </div>
            <div>
              <strong>{snapshotAccountCopy(props.account)}</strong>
              <span>Центр аккаунтов и готовые UI-точки интеграции</span>
            </div>
          </article>
        </div>
      </section>

      <section className="section-block">
        <div className="section-heading">
          <div>
            <h2>Действия Steam</h2>
            <p>Кнопки проверяют цель и служат стабильными точками подключения официального API.</p>
          </div>
          <span className="safe-badge">
            <ShieldCheck size={15} />
            API-каркас
          </span>
        </div>
        <div className="target-panel">
          <div className="target-input-wrap">
            <ExternalLink size={18} />
            <input
              id="action-target-url"
              value={props.targetUrl}
              onChange={(event) => props.onTargetChange(event.target.value)}
              placeholder="https://steamcommunity.com/sharedfiles/filedetails/?id=..."
            />
          </div>
          <div className="target-input-wrap comment">
            <Clipboard size={18} />
            <input
              id="action-comment-text"
              value={props.commentText}
              onChange={(event) => props.onCommentChange(event.target.value)}
              placeholder="Текст комментария для будущего официального адаптера"
            />
          </div>
        </div>
        <div className="action-grid">
          {actionButtons.map((action) => {
            const Icon = action.icon
            return (
              <button
                id={action.id}
                key={action.id}
                className={`action-card ${action.color}`}
                disabled={props.busy === action.id}
                onClick={() => props.onAction(action.id)}
              >
                <span className="action-icon">
                  <Icon size={21} />
                </span>
                <span className="action-copy">
                  <strong>{action.label}</strong>
                  <small>{action.description}</small>
                </span>
                <ChevronRight size={18} className="action-arrow" />
              </button>
            )
          })}
        </div>
      </section>

      <section className="section-block">
        <div className="section-heading">
          <div>
            <h2>Последние задания</h2>
            <p>Проверки выполняются параллельно в локальной очереди.</p>
          </div>
        </div>
        {props.recentTasks.length ? (
          <div className="compact-task-list">
            {props.recentTasks.map((task) => (
              <TaskRow key={task.id} task={task} />
            ))}
          </div>
        ) : (
          <EmptyState
            icon={ListTodo}
            title="Заданий пока нет"
            text="Проверка аккаунта или страницы Steam появится здесь."
          />
        )}
      </section>
    </div>
  )
}

function snapshotAccountCopy(account?: Account): string {
  return account ? 'Аккаунт выбран' : 'Добавьте первый аккаунт'
}

function accountStatusLabel(status: Account['status']): string {
  if (status === 'available') return 'Готов'
  if (status === 'checking') return 'Проверяется'
  if (status === 'unavailable') return 'Ошибка'
  return 'Не запущен'
}

function AccountsPage({
  accounts,
  selectedIds,
  busy,
  onAdd,
  onImport,
  onExport,
  onToggle,
  onToggleAll,
  onCheck,
  onStart,
  onStartAll,
  onStop,
  onEdit,
  onRestart,
  onOpen,
  onRemove
}: {
  accounts: Account[]
  selectedIds: string[]
  busy?: string
  onAdd: () => void
  onImport: () => void
  onExport: (format: 'txt' | 'excel') => void
  onToggle: (accountId: string) => void
  onToggleAll: () => void
  onCheck: () => void
  onStart: () => void
  onStartAll: () => void
  onStop: () => void
  onEdit: (account: Account) => void
  onRestart: (account: Account) => void
  onOpen: (account: Account) => void
  onRemove: (account: Account) => void
}): React.JSX.Element {
  const allSelected = accounts.length > 0 && selectedIds.length === accounts.length
  const readyCount = accounts.filter((entry) => entry.status === 'available').length
  const errorCount = accounts.filter((entry) => entry.status === 'unavailable').length

  return (
    <div className="page">
      <section className="page-heading">
        <div>
          <span className="eyebrow">Центр управления</span>
          <h1>Аккаунты</h1>
          <p>Карточки, массовый выбор и готовые точки подключения ваших обработчиков.</p>
        </div>
        <div className="heading-actions accounts-heading-actions">
          <button id="accounts-import-open" className="button ghost" onClick={onImport}>
            <FileUp size={17} />
            Импорт
          </button>
          <button
            id="accounts-export-txt"
            className="button ghost square"
            title="Экспорт TXT"
            onClick={() => onExport('txt')}
          >
            <Download size={17} />
          </button>
          <button
            id="accounts-export-excel"
            className="button ghost square"
            title="Экспорт Excel"
            onClick={() => onExport('excel')}
          >
            <FileSpreadsheet size={17} />
          </button>
          <button id="accounts-add-open" className="button primary" onClick={onAdd}>
            <Plus size={17} />
            Добавить
          </button>
        </div>
      </section>

      <section className="account-summary-strip">
        <div>
          <strong>{accounts.length}</strong>
          <span>Всего</span>
        </div>
        <div className="success">
          <strong>{readyCount}</strong>
          <span>Готовы</span>
        </div>
        <div className="warning">
          <strong>{accounts.length - readyCount - errorCount}</strong>
          <span>Не запущены</span>
        </div>
        <div className="error">
          <strong>{errorCount}</strong>
          <span>С ошибкой</span>
        </div>
      </section>

      {accounts.length > 0 && (
        <section className="accounts-bulk-bar">
          <button
            id="accounts-select-all"
            className={`select-all-control ${allSelected ? 'selected' : ''}`}
            onClick={onToggleAll}
          >
            <span className="fake-checkbox">{allSelected ? '✓' : ''}</span>
            {allSelected ? 'Снять выбор' : 'Выбрать все'}
          </button>
          <span className="selection-count">Выбрано: {selectedIds.length}</span>
          <div className="bulk-actions">
            <button
              id="accounts-check-selected"
              className="button ghost compact"
              disabled={selectedIds.length === 0 || busy === 'accounts-check-selected'}
              onClick={onCheck}
            >
              <SearchCheck size={15} />
              Проверить
            </button>
            <button
              id="accounts-start-selected"
              className="button primary compact"
              disabled={selectedIds.length === 0}
              onClick={onStart}
            >
              <Power size={15} />
              Запустить выбранные
            </button>
            <button id="accounts-start-all" className="button ghost compact" onClick={onStartAll}>
              <Play size={15} />
              Запустить все
            </button>
            <button
              id="accounts-stop-selected"
              className="button ghost compact danger-text"
              disabled={selectedIds.length === 0}
              onClick={onStop}
            >
              <Minus size={15} />
              Остановить
            </button>
          </div>
        </section>
      )}

      {!accounts.length ? (
        <div className="large-empty">
          <div className="large-empty-icon">
            <Users size={42} />
          </div>
          <h2>Добавьте аккаунты</h2>
          <p>
            Можно открыть форму одного аккаунта или макет массового импорта из TXT, CSV и Excel.
          </p>
          <div className="empty-actions">
            <button id="accounts-empty-import" className="button ghost" onClick={onImport}>
              <FileUp size={17} />
              Импортировать
            </button>
            <button id="accounts-empty-add" className="button primary" onClick={onAdd}>
              <Plus size={17} />
              Добавить вручную
            </button>
          </div>
        </div>
      ) : (
        <div className="accounts-grid">
          {accounts.map((entry) => {
            const selected = selectedIds.includes(entry.id)
            return (
              <article
                className={`account-card ${selected ? 'selected' : ''}`}
                key={entry.id}
              >
                <button
                  id={`account-select-${entry.id}`}
                  className="account-select"
                  aria-pressed={selected}
                  title="Выбрать аккаунт"
                  onClick={() => onToggle(entry.id)}
                >
                  {selected ? '✓' : ''}
                </button>
                <div className="account-card-top">
                  <div className="account-card-avatar">
                    {entry.label.slice(0, 1).toUpperCase()}
                    <span className={`account-presence ${entry.status}`} />
                  </div>
                  <div className="account-card-heading">
                    <span className={`status-chip ${entry.status}`}>
                      {accountStatusLabel(entry.status)}
                    </span>
                    <h3>{entry.label}</h3>
                    <span className="account-login-preview">@{entry.identifier}</span>
                  </div>
                </div>
                <div className="account-card-meta">
                  <div>
                    <span>Shared secret</span>
                    <strong className="secret-placeholder">
                      <LockKeyhole size={13} />
                      Не задан
                    </strong>
                  </div>
                  <div>
                    <span>Последняя проверка</span>
                    <strong>{formatDate(entry.lastCheckedAt)}</strong>
                  </div>
                </div>
                {entry.lastError && <div className="account-card-error">{entry.lastError}</div>}
                <div className="account-card-actions">
                  <button
                    id={`account-edit-${entry.id}`}
                    className="account-icon-action"
                    title="Редактировать"
                    onClick={() => onEdit(entry)}
                  >
                    <Edit3 size={16} />
                  </button>
                  <button
                    id={`account-restart-${entry.id}`}
                    className="account-icon-action"
                    title="Перезапустить"
                    onClick={() => onRestart(entry)}
                  >
                    <RotateCcw size={16} />
                  </button>
                  <button
                    id={`account-open-${entry.id}`}
                    className="account-icon-action"
                    title="Открыть публичный профиль"
                    onClick={() => onOpen(entry)}
                  >
                    <ExternalLink size={16} />
                  </button>
                  <button
                    id={`account-remove-${entry.id}`}
                    className="account-icon-action danger"
                    title="Удалить"
                    disabled={busy === `account-remove-${entry.id}`}
                    onClick={() => onRemove(entry)}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}

function TasksPage({
  tasks,
  busy,
  onCreate,
  onPause,
  onResume,
  onCancel,
  onRemove
}: {
  tasks: WorkspaceTask[]
  busy?: string
  onCreate: () => void
  onPause: (id: string) => void
  onResume: (id: string) => void
  onCancel: (id: string) => void
  onRemove: (id: string) => void
}): React.JSX.Element {
  return (
    <div className="page">
      <section className="page-heading">
        <div>
          <span className="eyebrow">Очередь</span>
          <h1>Задания</h1>
          <p>Запускайте несколько проверок, ставьте их на паузу и следите за прогрессом.</p>
        </div>
        <button id="task-create-open" className="button primary" onClick={onCreate}>
          <Plus size={17} />
          Новое задание
        </button>
      </section>
      {tasks.length ? (
        <div className="task-list">
          {tasks.map((task) => {
            const progress = taskProgress(task)
            return (
              <article className="task-card" key={task.id}>
                <div className="task-card-top">
                  <div className="task-kind-icon">
                    {task.kind === 'profile-check' ? (
                      <SearchCheck size={20} />
                    ) : (
                      <FileCheck2 size={20} />
                    )}
                  </div>
                  <div className="task-main">
                    <div className="task-title-row">
                      <div>
                        <h3>{task.title}</h3>
                        <span>
                          {task.items.length} элементов · {formatDate(task.createdAt)}
                        </span>
                      </div>
                      <span className={`task-status ${task.status}`}>
                        {taskStatusLabel(task)}
                      </span>
                    </div>
                    <div className="progress-row">
                      <div className="progress-track">
                        <span style={{ width: `${progress}%` }} />
                      </div>
                      <strong>{progress}%</strong>
                    </div>
                  </div>
                </div>
                <div className="task-card-actions">
                  {(task.status === 'running' || task.status === 'queued') && (
                    <button
                      id={`task-pause-${task.id}`}
                      className="button ghost compact"
                      disabled={busy === `pause-${task.id}`}
                      onClick={() => onPause(task.id)}
                    >
                      <Pause size={15} />
                      Пауза
                    </button>
                  )}
                  {task.status === 'paused' && (
                    <button
                      id={`task-resume-${task.id}`}
                      className="button ghost compact"
                      disabled={busy === `resume-${task.id}`}
                      onClick={() => onResume(task.id)}
                    >
                      <Play size={15} />
                      Продолжить
                    </button>
                  )}
                  {['running', 'queued', 'paused'].includes(task.status) && (
                    <button
                      id={`task-cancel-${task.id}`}
                      className="button ghost compact"
                      disabled={busy === `cancel-${task.id}`}
                      onClick={() => onCancel(task.id)}
                    >
                      <X size={15} />
                      Отменить
                    </button>
                  )}
                  {['completed', 'failed', 'cancelled'].includes(task.status) && (
                    <button
                      id={`task-remove-${task.id}`}
                      className="button ghost compact danger-text"
                      disabled={busy === `remove-${task.id}`}
                      onClick={() => onRemove(task.id)}
                    >
                      <Trash2 size={15} />
                      Удалить
                    </button>
                  )}
                </div>
              </article>
            )
          })}
        </div>
      ) : (
        <div className="large-empty">
          <div className="large-empty-icon">
            <ListTodo size={42} />
          </div>
          <h2>Очередь свободна</h2>
          <p>Создайте проверку аккаунта, локальной записи или страницы Steam.</p>
          <button id="task-empty-create" className="button primary" onClick={onCreate}>
            <Plus size={17} />
            Создать задание
          </button>
        </div>
      )}
    </div>
  )
}

function ActivityPage({
  entries,
  onClear
}: {
  entries: WorkspaceSnapshot['activity']
  onClear: () => void
}): React.JSX.Element {
  return (
    <div className="page">
      <section className="page-heading">
        <div>
          <span className="eyebrow">История</span>
          <h1>Журнал событий</h1>
          <p>Локальная история проверок, переходов и изменений.</p>
        </div>
        <button id="activity-clear" className="button ghost" onClick={onClear}>
          <Trash2 size={17} />
          Очистить
        </button>
      </section>
      <div className="activity-list">
        {entries.map((entry) => (
          <div className="activity-row" key={entry.id}>
            <span className={`activity-dot ${entry.level}`} />
            <div>
              <strong>{entry.message}</strong>
              <span>{formatDate(entry.createdAt)}</span>
            </div>
          </div>
        ))}
        {!entries.length && (
          <EmptyState
            icon={Activity}
            title="Журнал пуст"
            text="Новые события появятся здесь автоматически."
          />
        )}
      </div>
    </div>
  )
}

function SettingsPage({
  settings,
  busy,
  onChange,
  onSave,
  onFullscreen
}: {
  settings: WorkspaceSettings
  busy?: string
  onChange: (settings: WorkspaceSettings) => void
  onSave: () => void
  onFullscreen: () => void
}): React.JSX.Element {
  return (
    <div className="page">
      <section className="page-heading">
        <div>
          <span className="eyebrow">Конфигурация</span>
          <h1>Настройки</h1>
          <p>Параметры локальной очереди и интеграционные идентификаторы.</p>
        </div>
        <button id="settings-save" className="button primary" disabled={busy === 'settings-save'} onClick={onSave}>
          <CheckCircle2 size={17} />
          Сохранить
        </button>
      </section>
      <div className="settings-grid">
        <section className="settings-card">
          <h2>Очередь заданий</h2>
          <label>
            Параллельных проверок
            <input
              id="settings-concurrency"
              type="number"
              min={1}
              max={10}
              value={settings.concurrency}
              onChange={(event) =>
                onChange({ ...settings, concurrency: Number(event.target.value) })
              }
            />
            <small>От 1 до 10 одновременных операций.</small>
          </label>
          <label>
            Таймаут запроса, секунд
            <input
              id="settings-timeout"
              type="number"
              min={3}
              max={60}
              value={settings.requestTimeoutSeconds}
              onChange={(event) =>
                onChange({ ...settings, requestTimeoutSeconds: Number(event.target.value) })
              }
            />
          </label>
          <label>
            Пауза между элементами, мс
            <input
              id="settings-delay"
              type="number"
              min={100}
              max={5000}
              value={settings.itemDelayMs}
              onChange={(event) =>
                onChange({ ...settings, itemDelayMs: Number(event.target.value) })
              }
            />
          </label>
        </section>
        <section className="settings-card">
          <h2>Окно приложения</h2>
          <p className="settings-description">
            Интерфейс адаптируется к компактному окну и широкому экрану.
          </p>
          <button id="settings-fullscreen" className="button ghost full" onClick={onFullscreen}>
            <Maximize2 size={17} />
            Переключить полный экран
          </button>
          <div className="settings-separator" />
          <h3>Режим интеграции</h3>
          <div className="integration-status">
            <ShieldCheck size={20} />
            <div>
              <strong>Ручное подтверждение</strong>
              <span>Социальные действия не отправляются без официального метода Valve.</span>
            </div>
          </div>
        </section>
        <section className="settings-card ids-card">
          <h2>ID основных кнопок</h2>
          <p className="settings-description">
            Эти идентификаторы стабильны и подходят для дальнейшего подключения обработчиков.
          </p>
          <div className="id-list">
            {actionButtons.map((action) => (
              <div key={action.id}>
                <span>{action.label}</span>
                <code>{action.id}</code>
              </div>
            ))}
            <div>
              <span>Проверить аккаунт</span>
              <code>account-check-now</code>
            </div>
            <div>
              <span>Создать задание</span>
              <code>task-create-submit</code>
            </div>
            <div>
              <span>Импорт аккаунтов</span>
              <code>accounts-import-open</code>
            </div>
            <div>
              <span>Экспорт TXT</span>
              <code>accounts-export-txt</code>
            </div>
            <div>
              <span>Экспорт Excel</span>
              <code>accounts-export-excel</code>
            </div>
            <div>
              <span>Запустить выбранные</span>
              <code>accounts-start-selected</code>
            </div>
            <div>
              <span>Запустить все</span>
              <code>accounts-start-all</code>
            </div>
            <div>
              <span>Остановить выбранные</span>
              <code>accounts-stop-selected</code>
            </div>
            <div>
              <span>Создать shared secret</span>
              <code>account-create-shared-secret</code>
            </div>
            <div>
              <span>Сохранить изменения</span>
              <code>account-edit-save</code>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}

function TaskRow({ task }: { task: WorkspaceTask }): React.JSX.Element {
  const progress = taskProgress(task)
  return (
    <div className="compact-task">
      <div className="compact-task-icon">
        <Clock3 size={18} />
      </div>
      <div className="compact-task-copy">
        <strong>{task.title}</strong>
        <div className="progress-track small">
          <span style={{ width: `${progress}%` }} />
        </div>
      </div>
      <span className={`task-status ${task.status}`}>{progress}%</span>
    </div>
  )
}

function EmptyState({
  icon: Icon,
  title,
  text
}: {
  icon: typeof Activity
  title: string
  text: string
}): React.JSX.Element {
  return (
    <div className="empty-state">
      <Icon size={24} />
      <div>
        <strong>{title}</strong>
        <span>{text}</span>
      </div>
    </div>
  )
}

function Modal({
  title,
  children,
  onClose
}: {
  title: string
  children: React.ReactNode
  onClose: () => void
}): React.JSX.Element {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div className="modal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <h2>{title}</h2>
          <button className="icon-button" aria-label="Закрыть" onClick={onClose}>
            <X size={19} />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

export default App
