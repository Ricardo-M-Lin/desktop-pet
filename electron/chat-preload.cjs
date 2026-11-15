"use strict";

const { contextBridge, ipcRenderer } = require("electron");

function subscribe(channel, callback) {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld("eri", {
  getState: () => ipcRenderer.invoke("app:get-state"),
  getVersion: () => ipcRenderer.invoke("app:version"),
  saveSettings: (patch) => ipcRenderer.invoke("app:save-settings", patch),
  setPinned: (pinned) => ipcRenderer.invoke("window:set-pin", pinned),

  sendChat: (payload) => ipcRenderer.send("chat:start", payload),
  abortChat: (requestId) => ipcRenderer.send("chat:abort", requestId),
  onDelta: (callback) => subscribe("chat:delta", callback),
  onDone: (callback) => subscribe("chat:done", callback),
  onError: (callback) => subscribe("chat:error", callback),
  onOpenSettings: (callback) => subscribe("ui:open-settings", callback),

  listModels: (payload) => ipcRenderer.invoke("models:list", payload),
  testConnection: (payload) => ipcRenderer.invoke("api:test", payload),
  locatePet: () => ipcRenderer.invoke("pet:locate"),
  listMemory: () => ipcRenderer.invoke("shihai:list"),
  exportText: (payload) => ipcRenderer.invoke("dialog:export", payload),

  listVoices: () => ipcRenderer.invoke("tts:voices"),
  speak: (payload) => ipcRenderer.invoke("tts:speak", payload),
  stopVoice: () => ipcRenderer.send("tts:stop"),
  voiceStatus: () => ipcRenderer.invoke("tts:status"),
  startVoice: () => ipcRenderer.invoke("tts:start"),
  onVoiceLog: (callback) => subscribe("tts:log", callback),

  minimize: () => ipcRenderer.send("window:minimize"),
  hide: () => ipcRenderer.send("window:hide"),
  openCall: () => ipcRenderer.invoke("call:open"),
  quit: () => ipcRenderer.send("app:quit"),
  openLink: (url) => ipcRenderer.send("app:open-link", url),
});
