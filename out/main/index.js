"use strict";
const electron = require("electron");
const crypto = require("crypto");
const path = require("path");
const promises = require("fs/promises");
const allowedSteamHosts = /* @__PURE__ */ new Set([
  "steamcommunity.com",
  "www.steamcommunity.com",
  "store.steampowered.com",
  "help.steampowered.com"
]);
function normalizeProfile(identifier) {
  const value = identifier.trim();
  if (!value) throw new Error("Укажите SteamID, vanity ID или ссылку на профиль.");
  if (/^\d{17}$/.test(value)) {
    return {
      identifier: value,
      profileUrl: `https://steamcommunity.com/profiles/${value}`
    };
  }
  if (/^[a-zA-Z0-9_-]{2,64}$/.test(value)) {
    return {
      identifier: value,
      profileUrl: `https://steamcommunity.com/id/${value}`
    };
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Не удалось распознать профиль Steam.");
  }
  if (url.protocol !== "https:" || !allowedSteamHosts.has(url.hostname.toLowerCase())) {
    throw new Error("Разрешены только HTTPS-ссылки на официальные домены Steam.");
  }
  if (!/^\/(id|profiles)\/[^/]+\/?$/i.test(url.pathname)) {
    throw new Error("Ссылка должна вести на профиль steamcommunity.com/id/... или /profiles/...");
  }
  url.search = "";
  url.hash = "";
  return { identifier: value, profileUrl: url.toString().replace(/\/$/, "") };
}
function normalizeSteamUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    throw new Error("Укажите корректную HTTPS-ссылку Steam.");
  }
  if (url.protocol !== "https:" || !allowedSteamHosts.has(url.hostname.toLowerCase())) {
    throw new Error("Разрешены только HTTPS-ссылки на официальные домены Steam.");
  }
  return url.toString();
}
function taskKindLabel(kind) {
  if (kind === "profile-check") return "Проверка профилей";
  if (kind === "record-audit") return "Аудит записей";
  return "Проверка целевой страницы";
}
function createWorkspaceTask(input, snapshot) {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const title = input.title.trim() || taskKindLabel(input.kind);
  let items = [];
  let targetUrl;
  if (input.kind === "target-check") {
    targetUrl = normalizeSteamUrl(input.targetUrl ?? "");
    items = [
      {
        id: crypto.randomUUID(),
        label: targetUrl,
        status: "queued"
      }
    ];
  } else {
    const selected = new Set(input.accountIds ?? []);
    const accounts = snapshot.accounts.filter((account) => selected.has(account.id));
    if (accounts.length === 0) throw new Error("Выберите хотя бы один аккаунт.");
    items = accounts.map((account) => ({
      id: crypto.randomUUID(),
      accountId: account.id,
      label: account.label,
      status: "queued"
    }));
  }
  return {
    id: crypto.randomUUID(),
    title,
    kind: input.kind,
    targetUrl,
    status: "queued",
    items,
    createdAt: now,
    updatedAt: now
  };
}
class TaskRunner {
  constructor(store2) {
    this.store = store2;
  }
  store;
  activeCount = 0;
  scheduling = false;
  timer;
  controllers = /* @__PURE__ */ new Map();
  start() {
    this.timer = setInterval(() => void this.schedule(), 500);
    void this.schedule();
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
    for (const controller of this.controllers.values()) controller.abort();
  }
  kick() {
    void this.schedule();
  }
  cancel(taskId) {
    for (const [key, controller] of this.controllers) {
      if (key.startsWith(`${taskId}:`)) controller.abort();
    }
  }
  async schedule() {
    if (this.scheduling) return;
    this.scheduling = true;
    try {
      while (this.activeCount < this.store.peek().settings.concurrency) {
        const candidate = this.findCandidate();
        if (!candidate) break;
        await this.store.change((snapshot) => {
          const task = snapshot.tasks.find((entry) => entry.id === candidate.taskId);
          const item = task?.items.find((entry) => entry.id === candidate.itemId);
          if (!task || !item || item.status !== "queued") return;
          task.status = "running";
          task.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
          item.status = "running";
        });
        this.activeCount += 1;
        void this.execute(candidate.taskId, candidate.itemId).finally(() => {
          this.activeCount -= 1;
          void this.schedule();
        });
      }
    } finally {
      this.scheduling = false;
    }
  }
  findCandidate() {
    for (const task of this.store.peek().tasks) {
      if (task.status !== "queued" && task.status !== "running") continue;
      const item = task.items.find((entry) => entry.status === "queued");
      if (item) return { taskId: task.id, itemId: item.id };
    }
    return void 0;
  }
  async execute(taskId, itemId) {
    const snapshot = this.store.peek();
    const task = snapshot.tasks.find((entry) => entry.id === taskId);
    const item = task?.items.find((entry) => entry.id === itemId);
    if (!task || !item) return;
    const controller = new AbortController();
    const controllerKey = `${taskId}:${itemId}`;
    this.controllers.set(controllerKey, controller);
    try {
      await this.delay(snapshot.settings.itemDelayMs, controller.signal);
      if (task.kind === "profile-check") {
        const account = snapshot.accounts.find((entry) => entry.id === item.accountId);
        if (!account) throw new Error("Аккаунт больше не существует.");
        await this.setAccountChecking(account.id);
        await this.checkPublicUrl(account.profileUrl, controller);
        await this.finishAccountCheck(account.id, true);
      } else if (task.kind === "record-audit") {
        const account = snapshot.accounts.find((entry) => entry.id === item.accountId);
        if (!account) throw new Error("Аккаунт больше не существует.");
        normalizeProfile(account.profileUrl);
      } else if (task.targetUrl) {
        await this.checkPublicUrl(task.targetUrl, controller);
      }
      await this.finishItem(taskId, itemId, true);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (task.kind === "profile-check" && item.accountId && message !== "Операция отменена.") {
        await this.finishAccountCheck(item.accountId, false, message);
      }
      await this.finishItem(taskId, itemId, false, message);
    } finally {
      this.controllers.delete(controllerKey);
    }
  }
  async checkPublicUrl(url, controller) {
    const timeoutMs = this.store.peek().settings.requestTimeoutSeconds * 1e3;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        method: "GET",
        redirect: "follow",
        signal: controller.signal,
        headers: { "user-agent": "Steam Desk/1.0 public profile checker" }
      });
      await response.body?.cancel();
      if (response.status >= 500) throw new Error(`Steam ответил кодом ${response.status}.`);
    } catch (error) {
      if (controller.signal.aborted) throw new Error("Операция отменена.");
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
  async setAccountChecking(accountId) {
    await this.store.change((snapshot) => {
      const account = snapshot.accounts.find((entry) => entry.id === accountId);
      if (account) {
        account.status = "checking";
        account.lastError = void 0;
      }
    });
  }
  async finishAccountCheck(accountId, success, error) {
    await this.store.change((snapshot) => {
      const account = snapshot.accounts.find((entry) => entry.id === accountId);
      if (!account) return;
      account.status = success ? "available" : "unavailable";
      account.lastCheckedAt = (/* @__PURE__ */ new Date()).toISOString();
      account.lastError = error;
    });
  }
  async finishItem(taskId, itemId, success, error) {
    let logMessage = "";
    let logLevel = success ? "success" : "error";
    await this.store.change((snapshot) => {
      const task = snapshot.tasks.find((entry) => entry.id === taskId);
      const item = task?.items.find((entry) => entry.id === itemId);
      if (!task || !item) return;
      if (task.status === "cancelled" || error === "Операция отменена.") {
        item.status = "cancelled";
        logMessage = `Отменено: ${task.title} / ${item.label}`;
        logLevel = "warning";
      } else {
        item.status = success ? "completed" : "failed";
        item.error = error;
        item.completedAt = (/* @__PURE__ */ new Date()).toISOString();
        logMessage = success ? `Готово: ${task.title} / ${item.label}` : `Ошибка: ${task.title} / ${item.label}: ${error}`;
      }
      const hasQueued = task.items.some(
        (entry) => ["queued", "running"].includes(entry.status)
      );
      if (!hasQueued && task.status !== "cancelled") {
        task.status = task.items.some((entry) => entry.status === "failed") ? "failed" : "completed";
      }
      task.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
      if (logMessage) {
        snapshot.activity.unshift({
          id: crypto.randomUUID(),
          level: logLevel,
          message: logMessage,
          createdAt: (/* @__PURE__ */ new Date()).toISOString()
        });
      }
    });
  }
  delay(ms, signal) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, ms);
      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          reject(new Error("Операция отменена."));
        },
        { once: true }
      );
    });
  }
}
const defaultSettings = {
  concurrency: 3,
  requestTimeoutSeconds: 12,
  itemDelayMs: 350,
  minimizeToTray: false
};
function createDefaultSnapshot() {
  return {
    accounts: [],
    tasks: [],
    activity: [
      {
        id: crypto.randomUUID(),
        level: "info",
        message: "Рабочее пространство готово. Добавьте публичные профили Steam.",
        createdAt: (/* @__PURE__ */ new Date()).toISOString()
      }
    ],
    settings: defaultSettings
  };
}
class WorkspaceStore {
  filePath = path.join(electron.app.getPath("userData"), "steam-desk-workspace.json");
  snapshot = createDefaultSnapshot();
  writeChain = Promise.resolve();
  onChange;
  async load() {
    try {
      const saved = JSON.parse(await promises.readFile(this.filePath, "utf8"));
      this.snapshot = {
        accounts: Array.isArray(saved.accounts) ? saved.accounts : [],
        tasks: Array.isArray(saved.tasks) ? saved.tasks : [],
        activity: Array.isArray(saved.activity) ? saved.activity.slice(0, 300) : [],
        settings: { ...defaultSettings, ...saved.settings }
      };
      for (const task of this.snapshot.tasks) {
        if (task.status === "running") task.status = "queued";
        for (const item of task.items) {
          if (item.status === "running") item.status = "queued";
        }
      }
    } catch {
      this.snapshot = createDefaultSnapshot();
      await this.persist();
    }
  }
  setChangeListener(listener) {
    this.onChange = listener;
  }
  peek() {
    return this.snapshot;
  }
  clone() {
    return structuredClone(this.snapshot);
  }
  async change(mutator) {
    let result;
    const operation = this.writeChain.catch(() => void 0).then(async () => {
      result = mutator(this.snapshot);
      this.snapshot.activity = this.snapshot.activity.slice(0, 300);
      await this.persist();
      this.onChange?.(this.clone());
    });
    this.writeChain = operation;
    await operation;
    return result;
  }
  async addActivity(level, message, persist = true) {
    const add = (snapshot) => {
      snapshot.activity.unshift({
        id: crypto.randomUUID(),
        level,
        message,
        createdAt: (/* @__PURE__ */ new Date()).toISOString()
      });
    };
    if (persist) {
      await this.change(add);
    } else {
      add(this.snapshot);
    }
  }
  async persist() {
    await promises.mkdir(path.dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.tmp`;
    await promises.writeFile(tempPath, JSON.stringify(this.snapshot, null, 2), "utf8");
    await promises.rename(tempPath, this.filePath);
  }
}
let mainWindow = null;
const store = new WorkspaceStore();
const runner = new TaskRunner(store);
function broadcast(snapshot) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("workspace:snapshot", snapshot);
  }
}
function createWindow() {
  mainWindow = new electron.BrowserWindow({
    width: 1380,
    height: 860,
    minWidth: 1040,
    minHeight: 680,
    show: false,
    autoHideMenuBar: true,
    frame: false,
    backgroundColor: "#07111f",
    title: "Steam Desk",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      sandbox: false
    }
  });
  mainWindow.on("ready-to-show", () => mainWindow?.show());
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void openSteamUrl(url);
    return { action: "deny" };
  });
  if (!electron.app.isPackaged && process.env["ELECTRON_RENDERER_URL"]) {
    void mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    void mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
}
async function openSteamUrl(rawUrl, log = false) {
  const safeUrl = normalizeSteamUrl(rawUrl);
  await electron.shell.openExternal(safeUrl);
  if (log) await store.addActivity("info", `Открыта страница Steam: ${safeUrl}`);
}
function findTask(snapshot, taskId) {
  const task = snapshot.tasks.find((entry) => entry.id === taskId);
  if (!task) throw new Error("Задание не найдено.");
  return task;
}
function registerIpc() {
  electron.ipcMain.handle("workspace:get", () => store.clone());
  electron.ipcMain.handle("accounts:add", async (_event, input) => {
    const label = input.label.trim();
    if (!label) throw new Error("Укажите название аккаунта.");
    const normalized = normalizeProfile(input.identifier);
    await store.change((snapshot) => {
      if (snapshot.accounts.some((account) => account.profileUrl === normalized.profileUrl)) {
        throw new Error("Этот профиль уже добавлен.");
      }
      snapshot.accounts.unshift({
        id: crypto.randomUUID(),
        label,
        identifier: normalized.identifier,
        profileUrl: normalized.profileUrl,
        notes: input.notes?.trim() ?? "",
        status: "unknown",
        createdAt: (/* @__PURE__ */ new Date()).toISOString()
      });
      snapshot.activity.unshift({
        id: crypto.randomUUID(),
        level: "success",
        message: `Добавлен аккаунт «${label}».`,
        createdAt: (/* @__PURE__ */ new Date()).toISOString()
      });
    });
    return store.clone();
  });
  electron.ipcMain.handle("accounts:remove", async (_event, accountId) => {
    await store.change((snapshot) => {
      const account = snapshot.accounts.find((entry) => entry.id === accountId);
      snapshot.accounts = snapshot.accounts.filter((entry) => entry.id !== accountId);
      if (account) {
        snapshot.activity.unshift({
          id: crypto.randomUUID(),
          level: "warning",
          message: `Удалён аккаунт «${account.label}».`,
          createdAt: (/* @__PURE__ */ new Date()).toISOString()
        });
      }
    });
    return store.clone();
  });
  electron.ipcMain.handle("tasks:create", async (_event, input) => {
    let task;
    await store.change((snapshot) => {
      task = createWorkspaceTask(input, snapshot);
      snapshot.tasks.unshift(task);
      snapshot.activity.unshift({
        id: crypto.randomUUID(),
        level: "info",
        message: `Создано задание «${task.title}» на ${task.items.length} элементов.`,
        createdAt: (/* @__PURE__ */ new Date()).toISOString()
      });
    });
    runner.kick();
    return store.clone();
  });
  electron.ipcMain.handle("tasks:pause", async (_event, taskId) => {
    await store.change((snapshot) => {
      const task = findTask(snapshot, taskId);
      if (task.status === "queued" || task.status === "running") {
        task.status = "paused";
        task.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
      }
    });
    return store.clone();
  });
  electron.ipcMain.handle("tasks:resume", async (_event, taskId) => {
    await store.change((snapshot) => {
      const task = findTask(snapshot, taskId);
      if (task.status === "paused") {
        task.status = "queued";
        task.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
      }
    });
    runner.kick();
    return store.clone();
  });
  electron.ipcMain.handle("tasks:cancel", async (_event, taskId) => {
    await store.change((snapshot) => {
      const task = findTask(snapshot, taskId);
      task.status = "cancelled";
      task.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
      for (const item of task.items) {
        if (item.status === "queued") item.status = "cancelled";
      }
    });
    runner.cancel(taskId);
    return store.clone();
  });
  electron.ipcMain.handle("tasks:remove", async (_event, taskId) => {
    await store.change((snapshot) => {
      const task = findTask(snapshot, taskId);
      if (task.status === "running" || task.status === "queued") {
        throw new Error("Сначала завершите или отмените задание.");
      }
      snapshot.tasks = snapshot.tasks.filter((entry) => entry.id !== taskId);
    });
    return store.clone();
  });
  electron.ipcMain.handle("activity:clear", async () => {
    await store.change((snapshot) => {
      snapshot.activity = [];
    });
    return store.clone();
  });
  electron.ipcMain.handle("settings:update", async (_event, settings) => {
    const sanitized = {
      concurrency: Math.min(10, Math.max(1, Math.round(settings.concurrency))),
      requestTimeoutSeconds: Math.min(
        60,
        Math.max(3, Math.round(settings.requestTimeoutSeconds))
      ),
      itemDelayMs: Math.min(5e3, Math.max(100, Math.round(settings.itemDelayMs))),
      minimizeToTray: Boolean(settings.minimizeToTray)
    };
    await store.change((snapshot) => {
      snapshot.settings = sanitized;
      snapshot.activity.unshift({
        id: crypto.randomUUID(),
        level: "success",
        message: "Настройки сохранены.",
        createdAt: (/* @__PURE__ */ new Date()).toISOString()
      });
    });
    runner.kick();
    return store.clone();
  });
  electron.ipcMain.handle("external:open", async (_event, url) => openSteamUrl(url, true));
  electron.ipcMain.handle("clipboard:copy", async (_event, text) => {
    electron.clipboard.writeText(text.slice(0, 4e3));
    await store.addActivity("success", "Текст комментария скопирован в буфер обмена.");
  });
  electron.ipcMain.handle(
    "window:control",
    (_event, action) => {
      if (!mainWindow) return { maximized: false, fullscreen: false };
      if (action === "minimize") mainWindow.minimize();
      if (action === "maximize") {
        if (mainWindow.isMaximized()) mainWindow.unmaximize();
        else mainWindow.maximize();
      }
      if (action === "fullscreen") mainWindow.setFullScreen(!mainWindow.isFullScreen());
      if (action === "close") mainWindow.close();
      return {
        maximized: mainWindow.isMaximized(),
        fullscreen: mainWindow.isFullScreen()
      };
    }
  );
}
electron.app.whenReady().then(async () => {
  electron.app.setAppUserModelId("com.steamdesk.app");
  await store.load();
  store.setChangeListener(broadcast);
  registerIpc();
  runner.start();
  createWindow();
  electron.app.on("activate", () => {
    if (electron.BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
electron.app.on("before-quit", () => runner.stop());
electron.app.on("window-all-closed", () => {
  if (process.platform !== "darwin") electron.app.quit();
});
