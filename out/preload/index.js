"use strict";
const electron = require("electron");
const api = {
  getSnapshot: () => electron.ipcRenderer.invoke("workspace:get"),
  addAccount: (input) => electron.ipcRenderer.invoke("accounts:add", input),
  removeAccount: (accountId) => electron.ipcRenderer.invoke("accounts:remove", accountId),
  createTask: (input) => electron.ipcRenderer.invoke("tasks:create", input),
  pauseTask: (taskId) => electron.ipcRenderer.invoke("tasks:pause", taskId),
  resumeTask: (taskId) => electron.ipcRenderer.invoke("tasks:resume", taskId),
  cancelTask: (taskId) => electron.ipcRenderer.invoke("tasks:cancel", taskId),
  removeTask: (taskId) => electron.ipcRenderer.invoke("tasks:remove", taskId),
  clearActivity: () => electron.ipcRenderer.invoke("activity:clear"),
  updateSettings: (settings) => electron.ipcRenderer.invoke("settings:update", settings),
  openExternal: (url) => electron.ipcRenderer.invoke("external:open", url),
  copyText: (text) => electron.ipcRenderer.invoke("clipboard:copy", text),
  windowControl: (action) => electron.ipcRenderer.invoke("window:control", action),
  onSnapshot: (callback) => {
    const listener = (_event, snapshot) => callback(snapshot);
    electron.ipcRenderer.on("workspace:snapshot", listener);
    return () => electron.ipcRenderer.removeListener("workspace:snapshot", listener);
  }
};
if (process.contextIsolated) {
  electron.contextBridge.exposeInMainWorld("api", api);
} else {
  window.api = api;
}
