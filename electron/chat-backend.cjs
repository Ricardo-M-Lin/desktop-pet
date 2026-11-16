"use strict";

const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const http = require("node:http");
const { execFile, spawn } = require("node:child_process");

const {
  app,
  BrowserWindow,
  ipcMain,
  Tray,
  Menu,
  nativeImage,
  Notification,
  dialog,
  shell,
  screen,
  globalShortcut,
  safeStorage,
  net,
} = require("electron");

const {
  ApiError,
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
  listModels,
  maskKey,
  normalizeBaseUrl,
  readDshApiKey,
  streamChat,
} = require("./lib/api.cjs");
const tts = require("./lib/tts.cjs");

const APP_ROOT = __dirname;
const ASSET_ROOT = path.join(APP_ROOT, "..", "assets");
const ICON_PATH = path.join(ASSET_ROOT, "icon.ico");
const SHOTS_DIR = path.join(app.getPath("temp"), "eri-shots");

const argv = process.argv.slice(1);
const shotArg = argv.find((arg) => arg.startsWith("--shot="));
const shotMode = shotArg ? shotArg.split("=")[1] || "hero" : "";
const smokeMode = argv.includes("--smoke");
const smokeInputMode = argv.includes("--smoke-input");
const smokeSettingsMode = argv.includes("--smoke-settings");
const testMode = Boolean(shotMode || smokeMode || smokeInputMode || smokeSettingsMode);

// 身份由桌宠主进程设置
// 让回复可以直接朗读，不需要用户再点一下窗口
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
const customUserData = String(process.env.ERI_CHAT_USER_DATA || "").trim();
if (customUserData) {
  const userDataPath = path.resolve(customUserData);
  try {
    fs.mkdirSync(userDataPath, { recursive: true });
  } catch {}
  app.setPath("userData", userDataPath);
} else {
  const userDataPath = path.join(app.getPath("appData"), "EriDesktopChat");
  try {
    fs.mkdirSync(userDataPath, { recursive: true });
  } catch {}
  app.setPath("userData", userDataPath);
}
// AppUserModelId 由桌宠设置

const DEFAULT_SETTINGS = {
  personaId: "eri",
  personaName: "上杉绘梨衣",
  personaPrompt: "",
  userName: "",
  baseUrl: DEFAULT_BASE_URL,
  model: DEFAULT_MODEL,
  temperature: 0.9,
  maxTokens: 420,
  contextMessages: 40,
  stream: true,
  pinned: false,
  notifications: true,
  voiceEnabled: true,
  voiceId: tts.DEFAULT_VOICE,
  voiceRate: 0,
  localRoot: "C:\\Users\\linjunxin\\Documents\\GPT-SoVITS",
  localUrl: "http://127.0.0.1:9880",
  localRef: "ref-erii.wav",
  localPromptText: "书上说新春里会有好多新的美丽风景。",
  localPromptLang: "zh",
  apiKeyEnc: "",
  windowBounds: null,
  hideHintShown: false,
};

const SETTINGS_FILE = path.join(app.getPath("userData"), "settings.json");

let settings = loadSettings();
let mainWindow = null;
let tray = null;
let isQuitting = false;
let boundsTimer = null;
const activeRequests = new Map();
let lastPetBounds = null;

/* ------------------------------------------------------------------ */
/* Settings                                                           */
/* ------------------------------------------------------------------ */

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function cleanString(value, maxLength) {
  return String(value ?? "").slice(0, maxLength);
}

function sanitizeSettings(input) {
  const merged = { ...DEFAULT_SETTINGS, ...(input && typeof input === "object" ? input : {}) };
  const bounds = merged.windowBounds;
  const validBounds =
    bounds &&
    Number.isFinite(Number(bounds.x)) &&
    Number.isFinite(Number(bounds.y)) &&
    Number.isFinite(Number(bounds.width)) &&
    Number.isFinite(Number(bounds.height))
      ? {
          x: Math.round(Number(bounds.x)),
          y: Math.round(Number(bounds.y)),
          width: Math.round(Number(bounds.width)),
          height: Math.round(Number(bounds.height)),
        }
      : null;

  return {
    personaId: cleanString(merged.personaId, 60) || DEFAULT_SETTINGS.personaId,
    personaName: cleanString(merged.personaName, 60) || DEFAULT_SETTINGS.personaName,
    personaPrompt: cleanString(merged.personaPrompt, 20000),
    userName: cleanString(merged.userName, 32).trim(),
    baseUrl: normalizeBaseUrl(merged.baseUrl) || DEFAULT_BASE_URL,
    model: cleanString(merged.model, 160).trim() || DEFAULT_MODEL,
    temperature: clampNumber(merged.temperature, 0, 2, DEFAULT_SETTINGS.temperature),
    maxTokens: Math.round(clampNumber(merged.maxTokens, 64, 2048, DEFAULT_SETTINGS.maxTokens)),
    contextMessages: Math.round(
      clampNumber(merged.contextMessages, 4, 100, DEFAULT_SETTINGS.contextMessages),
    ),
    stream: merged.stream !== false,
    pinned: Boolean(merged.pinned),
    notifications: merged.notifications !== false,
    voiceEnabled: merged.voiceEnabled !== false,
    voiceId: tts.normalizeVoice(merged.voiceId),
    voiceRate: tts.normalizeRate(merged.voiceRate),
    localRoot: cleanString(merged.localRoot, 300).trim() || DEFAULT_SETTINGS.localRoot,
    localUrl: cleanString(merged.localUrl, 120).trim() || DEFAULT_SETTINGS.localUrl,
    localRef: cleanString(merged.localRef, 120).trim() || DEFAULT_SETTINGS.localRef,
    localPromptText: cleanString(merged.localPromptText, 500),
    localPromptLang: cleanString(merged.localPromptLang, 10).trim() || "zh",
    apiKeyEnc: typeof merged.apiKeyEnc === "string" ? merged.apiKeyEnc.slice(0, 4000) : "",
    windowBounds: validBounds,
    hideHintShown: Boolean(merged.hideHintShown),
  };
}

function loadSettings() {
  try {
    if (!fs.existsSync(SETTINGS_FILE)) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8"));
    return sanitizeSettings(parsed);
  } catch (error) {
    try {
      if (fs.existsSync(SETTINGS_FILE)) {
        fs.copyFileSync(SETTINGS_FILE, `${SETTINGS_FILE}.broken-${Date.now()}`);
      }
    } catch {}
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings() {
  try {
    fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
    const temporary = `${SETTINGS_FILE}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(settings, null, 2), "utf8");
    fs.renameSync(temporary, SETTINGS_FILE);
  } catch (error) {
    console.error("保存设置失败：", error?.message || error);
  }
}

function encryptKey(key) {
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return `enc:${safeStorage.encryptString(key).toString("base64")}`;
    }
  } catch {}
  return `plain:${key}`;
}

function decryptKey(encoded) {
  if (!encoded) return "";
  try {
    if (encoded.startsWith("enc:")) {
      if (!safeStorage.isEncryptionAvailable()) return "";
      return safeStorage.decryptString(Buffer.from(encoded.slice(4), "base64"));
    }
    if (encoded.startsWith("plain:")) return encoded.slice(6);
  } catch {}
  return "";
}

function resolveApi() {
  let key = "";
  let source = "none";
  if (settings.apiKeyEnc) {
    key = decryptKey(settings.apiKeyEnc);
    if (key) source = "local";
  }
  if (!key) {
    key = String(process.env.BAOMIAO_API_KEY || "").trim();
    if (key) source = "env";
  }
  if (!key) {
    key = readDshApiKey();
    if (key) source = "dsh";
  }
  return {
    configured: Boolean(key),
    source,
    key,
    keyMasked: maskKey(key),
    baseUrl: settings.baseUrl,
    model: settings.model,
  };
}

function publicSettings() {
  const { apiKeyEnc, ...rest } = settings;
  return { ...rest, hasLocalKey: Boolean(apiKeyEnc) };
}

function publicApi() {
  const api = resolveApi();
  return {
    configured: api.configured,
    source: api.source,
    keyMasked: api.keyMasked,
    baseUrl: api.baseUrl,
    model: api.model,
  };
}

/* ------------------------------------------------------------------ */
/* Desktop pet anchoring                                              */
/* ------------------------------------------------------------------ */

function findPetBounds() {
  const attempt = (remaining) =>
    new Promise((resolve) => {
      const script = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public struct ERI_PETRECT { public int Left; public int Top; public int Right; public int Bottom; }
public class EriPetFind {
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out ERI_PETRECT lpRect);
}
"@
$p = Get-Process electron -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -eq '桌宠' } | Select-Object -First 1
if (-not $p) { Write-Output 'NOT_FOUND'; exit 0 }
$handle = $p.MainWindowHandle
if ($handle -eq 0) { Write-Output 'NOT_FOUND'; exit 0 }
$rect = New-Object ERI_PETRECT
if ([EriPetFind]::GetWindowRect($handle, [ref]$rect)) {
  Write-Output ("{0}|{1}|{2}|{3}" -f $rect.Left, $rect.Top, $rect.Right, $rect.Bottom)
} else {
  Write-Output 'RECT_FAIL'
}
`;
      const encoded = Buffer.from(script, "utf16le").toString("base64");
      execFile(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded],
        { windowsHide: true, timeout: 6000, maxBuffer: 64 * 1024 },
        (error, stdout) => {
          let pet = null;
          if (!error) {
            const line = String(stdout || "")
              .split(/\r?\n/)
              .map((item) => item.trim())
              .find((item) => /^-?\d+\|-?\d+\|-?\d+\|-?\d+$/.test(item));
            if (line) {
              const [left, top, right, bottom] = line.split("|").map(Number);
              if ([left, top, right, bottom].every(Number.isFinite)) {
                pet = {
                  x: left,
                  y: top,
                  width: Math.max(1, right - left),
                  height: Math.max(1, bottom - top),
                };
              }
            }
          }
          if (pet) {
            resolve(pet);
            return;
          }
          if (remaining > 0) {
            setTimeout(() => {
              attempt(remaining - 1).then(resolve);
            }, 250);
            return;
          }
          resolve(null);
        },
      );
    });
  return attempt(1);
}

function isBoundsVisible(bounds) {
  if (!bounds) return false;
  return screen.getAllDisplays().some((display) => {
    const area = display.workArea;
    const overlapX =
      Math.min(bounds.x + bounds.width, area.x + area.width) - Math.max(bounds.x, area.x);
    const overlapY =
      Math.min(bounds.y + bounds.height, area.y + area.height) - Math.max(bounds.y, area.y);
    return overlapX > 100 && overlapY > 100;
  });
}

function chooseInitialSize() {
  const workArea = screen.getPrimaryDisplay().workArea;
  const width = Math.min(360, Math.max(340, workArea.width - 40));
  const height = Math.min(600, Math.max(520, workArea.height - 32));
  return { width, height };
}

async function placeWindow({ force = false } = {}) {
  if (!mainWindow || mainWindow.isDestroyed()) return null;
  const bounds = mainWindow.getBounds();
  if (!force && settings.windowBounds && isBoundsVisible(settings.windowBounds)) {
    mainWindow.setBounds(settings.windowBounds);
    return settings.windowBounds;
  }

  const pet = await findPetBounds();
  lastPetBounds = pet;
  const display = pet
    ? screen.getDisplayNearestPoint({
        x: Math.round(pet.x + pet.width / 2),
        y: Math.round(pet.y + pet.height / 2),
      })
    : screen.getPrimaryDisplay();
  const area = display.workArea;

  let x;
  let y;
  let source = "pet";
  if (pet) {
    // Sit just to the left of the pet, bottom edges aligned when there is room.
    x = pet.x - bounds.width - 18;
    y = pet.y + pet.height - bounds.height;
  } else {
    // Fallback: keep clear of the usual bottom-right pet position.
    source = "fallback";
    const petReserve = 210;
    x = area.x + area.width - bounds.width - 24 - petReserve;
    y = area.y + area.height - bounds.height - 24;
  }

  x = Math.min(area.x + area.width - bounds.width - 8, Math.max(area.x + 8, x));
  y = Math.min(area.y + area.height - bounds.height - 8, Math.max(area.y + 8, y));

  if (process.env.ERI_DEBUG_POSITION === "1") {
    try {
      fs.appendFileSync(
        path.join(app.getPath("userData"), "window-position.log"),
        `${JSON.stringify({
          at: new Date().toISOString(),
          source,
          pet,
          displayBounds: display.bounds,
          workArea: area,
          windowBounds: bounds,
          placed: { x: Math.round(x), y: Math.round(y) },
        })}\n`,
        "utf8",
      );
    } catch {}
  }

  mainWindow.setPosition(Math.round(x), Math.round(y));
  return { x: Math.round(x), y: Math.round(y), width: bounds.width, height: bounds.height };
}

/* ------------------------------------------------------------------ */
/* Window, tray, shortcuts                                            */
/* ------------------------------------------------------------------ */

function createWindow() {
  const { width, height } = chooseInitialSize();
  mainWindow = new BrowserWindow({
    width,
    height,
    minWidth: width,
    minHeight: height,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: false,
    resizable: false,
    maximizable: false,
    minimizable: true,
    fullscreenable: false,
    movable: true,
    closable: true,
    alwaysOnTop: Boolean(settings.pinned),
    title: "绘梨衣 · 桌宠对话",
    icon: ICON_PATH,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(APP_ROOT, "chat-preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      backgroundThrottling: false,
    },
  });

  mainWindow.setMenu(null);
  mainWindow.setAlwaysOnTop(Boolean(settings.pinned));
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event) => event.preventDefault());
  mainWindow.webContents.on("context-menu", (_event, params) => {
    const items = [];
    if (params.isEditable) {
      items.push(
        { role: "undo", label: "撤销" },
        { role: "redo", label: "重做" },
        { type: "separator" },
        { role: "cut", label: "剪切" },
        { role: "copy", label: "复制" },
        { role: "paste", label: "粘贴" },
        { role: "selectAll", label: "全选" },
      );
    } else if (params.selectionText) {
      items.push({ role: "copy", label: "复制" });
    }
    if (items.length) Menu.buildFromTemplate(items).popup({ window: mainWindow });
  });

  const query = shotMode
    ? { demo: shotMode }
    : process.env.ERI_START_PANEL
      ? { panel: process.env.ERI_START_PANEL, ...(process.env.ERI_START_GAME ? { game: process.env.ERI_START_GAME } : {}), ...(process.env.ERI_START_RULES ? { rules: '1' } : {}), ...(process.env.ERI_START_AUTO ? { auto: '1' } : {}) }
      : undefined;
  mainWindow.loadFile(path.join(APP_ROOT, "..", "src", "chat", "index.html"), query ? { query } : undefined);

    
  // fallback show
  setTimeout(() => {
    try {
      if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
        mainWindow.show();
        mainWindow.focus();
      }
    } catch {}
  }, 1200);

  mainWindow.once("ready-to-show", () => {
    if (testMode) {
      mainWindow.setPosition(40, 40);
      mainWindow.showInactive();
      if (shotMode) runShot(shotMode);
      if (smokeMode) runSmoke("plain");
      if (smokeInputMode) runSmoke("input");
      if (smokeSettingsMode) runSmoke("settings");
      return;
    }

    const saved = settings.windowBounds && isBoundsVisible(settings.windowBounds);
    if (saved) {
      // Keep the current (new) window size; the saved bounds only supply the
      // position. This lets a future resize take effect without deleting the
      // user's remembered spot.
      const display = screen.getDisplayNearestPoint({
        x: Math.round(settings.windowBounds.x + settings.windowBounds.width / 2),
        y: Math.round(settings.windowBounds.y + settings.windowBounds.height / 2),
      });
      const area = display.workArea;
      const initial = mainWindow.getBounds();
      const x = Math.min(
        area.x + area.width - initial.width - 8,
        Math.max(area.x + 8, settings.windowBounds.x),
      );
      const y = Math.min(
        area.y + area.height - initial.height - 8,
        Math.max(area.y + 8, settings.windowBounds.y),
      );
      mainWindow.setPosition(Math.round(x), Math.round(y));
    } else {
      // Show immediately near the usual bottom-right pet spot, then refine
      // the anchor asynchronously once the pet window has been located.
      const area = screen.getPrimaryDisplay().workArea;
      const initial = mainWindow.getBounds();
      const x = Math.max(area.x + 8, area.x + area.width - initial.width - 24 - 210);
      const y = Math.max(area.y + 8, area.y + area.height - initial.height - 24);
      mainWindow.setPosition(Math.round(x), Math.round(y));
    }
    mainWindow.show();
    mainWindow.focus();
    if (!saved) {
      placeWindow({ force: true }).catch(() => {});
    }
  });

  mainWindow.on("moved", () => {
    clearTimeout(boundsTimer);
    boundsTimer = setTimeout(() => {
      if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isMinimized()) return;
      settings.windowBounds = mainWindow.getBounds();
      saveSettings();
    }, 500);
  });

  mainWindow.on("close", (event) => {
    if (isQuitting) return;
    event.preventDefault();
    mainWindow.hide();
    if (!settings.hideHintShown) {
      settings.hideHintShown = true;
      saveSettings();
      showNotification("绘梨衣", "我还在托盘里哦，点一下小图标就能回来。");
    }
  });

  mainWindow.on("closed", () => {
    abortAllRequests();
    mainWindow = null;
  });
}

function showWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  mainWindow.setAlwaysOnTop(Boolean(settings.pinned));
}

function toggleWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isVisible() && mainWindow.isFocused()) mainWindow.hide();
  else showWindow();
}

function showNotification(title, body) {
  if (!Notification.isSupported()) return;
  try {
    const notification = new Notification({
      title,
      body: String(body || "").slice(0, 180),
      icon: path.join(ASSET_ROOT, "icon.png"),
      silent: false,
    });
    notification.on("click", showWindow);
    notification.show();
  } catch {}
}

function createTray() {
  try {
    let image = nativeImage.createFromPath(ICON_PATH);
    if (image.isEmpty()) image = nativeImage.createFromPath(path.join(ASSET_ROOT, "icon.png"));
    tray = new Tray(image);
    tray.setToolTip("绘梨衣 · 桌宠对话");
    const menu = Menu.buildFromTemplate([
      { label: "打开对话", click: showWindow },
      {
        label: "重新定位到桌宠",
        click: async () => {
          await placeWindow({ force: true });
          showWindow();
        },
      },
      {
        label: "性格设置",
        click: () => {
          showWindow();
          mainWindow?.webContents.send("ui:open-settings", "persona");
        },
      },
      { type: "separator" },
      { label: "退出", click: quitApp },
    ]);
    tray.setContextMenu(menu);
    tray.on("click", toggleWindow);
    tray.on("double-click", showWindow);
  } catch (error) {
    console.error("创建托盘失败：", error?.message || error);
  }
}

function registerShortcuts() {
  try {
    const ok = globalShortcut.register("CommandOrControl+Shift+E", toggleWindow);
    if (!ok) console.warn("快捷键 Ctrl+Shift+E 注册失败");
  } catch {}
}

function quitApp() {
  isQuitting = true;
  tts.stopAll();
  app.quit();
}

function abortAllRequests() {
  for (const entry of activeRequests.values()) {
    try {
      entry.controller.abort();
    } catch {}
  }
  activeRequests.clear();
}


/* ------------------------------------------------------------------ */
/* 视频通话窗口                                                        */
/* ------------------------------------------------------------------ */

const CALL_SERVER_PORT = 8890;
const CALL_DIR = process.env.ERI_CALL_DIR || "C:\\Users\\linjunxin\\Documents\\GPT-SoVITS";
let callWindow = null;
let callWatchdog = null;

function pingCallServer() {
  return new Promise((resolve) => {
    const req = http.get(
      { host: "127.0.0.1", port: CALL_SERVER_PORT, path: "/health", timeout: 800 },
      (res) => { res.resume(); resolve(res.statusCode === 200); },
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => { req.destroy(); resolve(false); });
  });
}

function pingTts() {
  return new Promise((resolve) => {
    const req = http.get(
      { host: "127.0.0.1", port: 9880, path: "/docs", timeout: 1200 },
      (res) => { res.resume(); resolve(res.statusCode === 200); },
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => { req.destroy(); resolve(false); });
  });
}

async function ensureTts() {
  if (await pingTts()) return true;
  const pyw = path.join(CALL_DIR, ".venv", "Scripts", "pythonw.exe");
  const script = path.join(CALL_DIR, "svc_tts.pyw");
  if (!fs.existsSync(pyw) || !fs.existsSync(script)) return false;
  try {
    const child = spawn(pyw, [script], {
      cwd: CALL_DIR, detached: true, stdio: "ignore", windowsHide: true,
    });
    child.unref();
  } catch { return false; }
  for (let i = 0; i < 60; i += 1) {
    await new Promise((r) => setTimeout(r, 1000));
    if (await pingTts()) return true;
  }
  return false;
}

async function ensureCallServer() {
  if (await pingCallServer()) return true;
  const python = path.join(CALL_DIR, ".venv", "Scripts", "python.exe");
  const script = path.join(CALL_DIR, "call_server.py");
  if (!fs.existsSync(python) || !fs.existsSync(script)) return false;
  try {
    const child = spawn(python, [script], {
      cwd: CALL_DIR, detached: true, stdio: "ignore", windowsHide: true,
    });
    child.unref();
  } catch { return false; }
  for (let i = 0; i < 60; i += 1) {
    await new Promise((r) => setTimeout(r, 500));
    if (await pingCallServer()) return true;
  }
  return false;
}

function openCallWindow() {
  if (callWindow && !callWindow.isDestroyed()) {
    callWindow.show();
    callWindow.focus();
    return;
  }
  callWindow = new BrowserWindow({
    width: 780,
    height: 640,
    minWidth: 560,
    minHeight: 480,
    frame: false,
    backgroundColor: "#120b10",
    show: false,
    resizable: true,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  callWindow.setMenu(null);
  callWindow.loadFile(path.join(APP_ROOT, "..", "src", "chat", "call.html"));
  ensureTts().catch(() => {});
  callWindow.once("ready-to-show", () => {
    callWindow.show();
    callWindow.focus();
  });
  callWindow.on("closed", () => {
    callWindow = undefined;
    if (callWatchdog) {
      clearInterval(callWatchdog);
      callWatchdog = undefined;
    }
  });
  if (callWatchdog) clearInterval(callWatchdog);
  callWatchdog = setInterval(async () => {
    if (!callWindow || callWindow.isDestroyed()) return;
    if (!(await pingCallServer())) ensureCallServer().catch(() => {});
  }, 20000);
  ensureTts().catch(() => {});
  ensureCallServer().catch(() => {});
}

/* ------------------------------------------------------------------ */
/* Chat requests                                                      */
/* ------------------------------------------------------------------ */

function sendToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
    mainWindow.webContents.send(channel, payload);
  }
}


/* ------------------------------------------------------------------ */
/* 识海：长期自我记忆                                                  */
/* ------------------------------------------------------------------ */

const LEGACY_SHIHAI = path.join(app.getPath("documents"), "绘梨衣对话", "识海");
const SHIHAI_DIR =
  process.env.ERI_MEMORY_DIR ||
  (fs.existsSync(LEGACY_SHIHAI) ? LEGACY_SHIHAI : path.join(app.getPath("userData"), "识海"));
const SHIHAI_FILES = ["self.md", "owner.md", "timeline.md", "canon.md"];

function ensureShihaiDir() {
  try { fs.mkdirSync(SHIHAI_DIR, { recursive: true }); } catch {}
}

function readShihai(name) {
  try {
    return fs.readFileSync(path.join(SHIHAI_DIR, name), "utf8").trim();
  } catch {
    return "";
  }
}

function readShihaiJson(name) {
  try {
    const data = JSON.parse(readShihai(name) || "[]");
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function buildShihaiCore(limit = 1700) {
  const parts = [];
  const titles = { "self.md": "自我", "owner.md": "主人", "timeline.md": "时间线", "canon.md": "语气" };
  const caps = { "self.md": 620, "owner.md": 360, "timeline.md": 480, "canon.md": 280 };
  for (const name of SHIHAI_FILES) {
    const text = readShihai(name);
    if (text) parts.push(`【${titles[name]}】\n${text.slice(0, caps[name])}`);
  }
  const facts = readShihaiJson("facts.json").slice(-8);
  if (facts.length) {
    const lines = facts
      .map((f) => String(f?.content || "").trim())
      .filter(Boolean)
      .map((c, i) => `- [${String(facts[i]?.created || "").slice(0, 10)}] ${c.slice(0, 180)}`);
    if (lines.length) parts.push("【事实】\n" + lines.join("\n"));
  }
  const loops = readShihaiJson("open_loops.json")
    .filter((x) => x?.status === "open")
    .slice(-5);
  if (loops.length) {
    const lines = loops.map((x) => `- ${String(x.content || "").slice(0, 120)}`).filter((l) => l.length > 2);
    if (lines.length) parts.push("【未完成】\n" + lines.join("\n"));
  }
  return parts.join("\n").slice(0, limit);
}

function rememberShihai(content, source = "对话") {
  const text = String(content || "").replace(/\s+/g, " ").trim().slice(0, 300);
  if (!text || /(密码|身份证|银行卡|手机号|验证码)/.test(text)) return false;
  const file = path.join(SHIHAI_DIR, "facts.json");
  try {
    let facts = [];
    try { facts = JSON.parse(fs.readFileSync(file, "utf8") || "[]"); } catch { facts = []; }
    if (!Array.isArray(facts)) facts = [];
    const norm = text.replace(/\s+/g, "");
    if (facts.some((f) => String(f?.content || "").replace(/\s+/g, "").includes(norm))) return false;
    facts.push({ content: text, created: new Date().toISOString().slice(0, 16).replace("T", " "), source, confidence: 0.75 });
    fs.mkdirSync(SHIHAI_DIR, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(facts.slice(-300), null, 2), "utf8");
    return true;
  } catch {
    return false;
  }
}

const SHIHAI_HINT = /(记住|记一下|别忘|我叫|我住|我是|我的生日|我喜欢|我讨厌|我害怕|我不喜欢|我在做|我在准备|我下周|我明天|我最近|我要去|我在学|我想学|我养了|我有只)/;

ipcMain.handle("shihai:list", () => {
  try {
    const facts = readShihaiJson("facts.json").slice(-80).reverse();
    const loops = readShihaiJson("open_loops.json").slice(-40).reverse();
    return {
      facts: facts.map((f) => ({
        content: String(f?.content || ""),
        created: String(f?.created || ""),
        source: String(f?.source || ""),
      })),
      loops: loops
        .filter((l) => l && l.status === "open")
        .map((l) => ({ content: String(l?.content || ""), due: String(l?.due || ""), created: String(l?.created || "") })),
      timeline: readShihai("timeline.md"),
      self: readShihai("self.md"),
      owner: readShihai("owner.md"),
      canon: readShihai("canon.md"),
    };
  } catch {
    return { facts: [], loops: [], timeline: "", self: "", owner: "", canon: "" };
  }
});

ipcMain.handle("shihai:delete", (_event, payload) => {
  try {
    const type = String(payload?.type || "");
    const content = String(payload?.content || "");
    if (!content) return { ok: false };
    if (type === "loop") {
      const loops = readShihaiJson("open_loops.json");
      const next = loops.filter((l) => String(l?.content || "") !== content);
      fs.writeFileSync(path.join(SHIHAI_DIR, "open_loops.json"), JSON.stringify(next.slice(-100), null, 2), "utf8");
      return { ok: true };
    }
    const facts = readShihaiJson("facts.json");
    const next = facts.filter((f) => String(f?.content || "") !== content);
    fs.writeFileSync(path.join(SHIHAI_DIR, "facts.json"), JSON.stringify(next.slice(-300), null, 2), "utf8");
    return { ok: true };
  } catch {
    return { ok: false };
  }
});

ipcMain.on("chat:start", (event, payload) => {
  const requestId = String(payload?.requestId || "");
  const api = resolveApi();
  if (!requestId) return;
  if (!api.configured) {
    sendToRenderer("chat:error", {
      requestId,
      message: "还没有配置 API Key，请打开设置 → 连接。",
      code: "no_key",
      aborted: false,
    });
    return;
  }

  const messages = Array.isArray(payload?.messages)
    ? payload.messages
        .filter(
          (message) =>
            message &&
            ["system", "user", "assistant"].includes(message.role) &&
            typeof message.content === "string" &&
            message.content.trim(),
        )
        .map((message) => ({
          role: message.role,
          content: message.content.slice(0, 20000),
        }))
    : [];
  const shihaiCore = buildShihaiCore();
  if (shihaiCore) {
    const sys = messages.find((m) => m.role === "system");
    const block =
      "\n\n【识海】下面是你自己保存的长期自我，不是聊天记录。" +
      "按它保持连续，不要逐条复述，也不要提起这段说明。\n" + shihaiCore;
    if (sys) sys.content = (sys.content || "") + block;
    else messages.unshift({ role: "system", content: block.trim() });
  }

  // 用户说了值得记的事就写进识海
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  if (lastUser && SHIHAI_HINT.test(lastUser.content)) {
    rememberShihai(lastUser.content);
  }

  if (!messages.some((message) => message.role === "user")) {
    sendToRenderer("chat:error", {
      requestId,
      message: "没有可发送的消息。",
      code: "no_messages",
      aborted: false,
    });
    return;
  }

  const controller = new AbortController();
  const entry = { controller, abortedByUser: false, partial: "" };
  activeRequests.set(requestId, entry);
  const timeout = setTimeout(() => {
    if (activeRequests.has(requestId)) {
      const reason = new ApiError("请求超时了，可能是网络不太稳定。", "timeout");
      controller.abort(reason);
    }
  }, 120000);

  streamChat({
    baseUrl: api.baseUrl,
    apiKey: api.key,
    model: api.model,
    messages,
    temperature: settings.temperature,
    maxTokens: settings.maxTokens,
    stream: settings.stream,
    signal: controller.signal,
    fetchImpl: net.fetch.bind(net),
    onDelta: (delta) => {
      entry.partial += delta;
      if (!event.sender.isDestroyed()) {
        event.sender.send("chat:delta", { requestId, delta });
      }
    },
  })
    .then((result) => {
      clearTimeout(timeout);
      activeRequests.delete(requestId);
      if (event.sender.isDestroyed()) return;
      event.sender.send("chat:done", {
        requestId,
        content: result.content,
        model: result.model,
        aborted: false,
      });
      if (settings.notifications && (!mainWindow || !mainWindow.isVisible())) {
        showNotification("绘梨衣", result.content || "我在这里。");
      }
    })
    .catch((error) => {
      clearTimeout(timeout);
      activeRequests.delete(requestId);
      if (event.sender.isDestroyed()) return;
      if (entry.abortedByUser) {
        event.sender.send("chat:done", {
          requestId,
          content: entry.partial,
          aborted: true,
        });
        return;
      }
      event.sender.send("chat:error", {
        requestId,
        message: error?.message || "连接失败，请稍后再试。",
        code: error?.code || "error",
        status: error?.status || 0,
        partial: entry.partial,
        aborted: false,
      });
    });
});

ipcMain.on("chat:abort", (_event, requestId) => {
  const entry = activeRequests.get(String(requestId || ""));
  if (!entry) return;
  entry.abortedByUser = true;
  try {
    entry.controller.abort(new ApiError("已停止回复", "aborted"));
  } catch {}
});

/* ------------------------------------------------------------------ */
/* IPC                                                                */
/* ------------------------------------------------------------------ */

ipcMain.handle("app:get-state", async () => ({
  version: app.getVersion(),
  settings: publicSettings(),
  api: publicApi(),
  platform: process.platform,
  shortcut: "Ctrl+Shift+E",
}));

ipcMain.handle("app:version", () => app.getVersion());

ipcMain.handle("app:save-settings", (_event, patch) => {
  if (!patch || typeof patch !== "object") {
    return { ok: false, error: "无效的设置。" };
  }

  const next = { ...settings };
  const errors = [];

  if (Object.prototype.hasOwnProperty.call(patch, "personaPrompt")) {
    const prompt = String(patch.personaPrompt ?? "").trim();
    if (!prompt) errors.push("性格提示词不能为空。");
    else if (prompt.length > 20000) errors.push("性格提示词太长了。");
    else next.personaPrompt = prompt;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "personaId")) {
    next.personaId = cleanString(patch.personaId, 60) || "eri";
  }
  if (Object.prototype.hasOwnProperty.call(patch, "personaName")) {
    next.personaName = cleanString(patch.personaName, 60) || "自定义性格";
  }
  if (Object.prototype.hasOwnProperty.call(patch, "userName")) {
    next.userName = cleanString(patch.userName, 32).trim();
  }
  if (Object.prototype.hasOwnProperty.call(patch, "baseUrl")) {
    const baseUrl = normalizeBaseUrl(patch.baseUrl);
    if (!/^https?:\/\//i.test(baseUrl)) errors.push("API 地址需要以 http:// 或 https:// 开头。");
    else next.baseUrl = baseUrl.slice(0, 300);
  }
  if (Object.prototype.hasOwnProperty.call(patch, "model")) {
    const model = cleanString(patch.model, 160).trim();
    if (!model) errors.push("请选择一个模型。");
    else next.model = model;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "temperature")) {
    next.temperature = clampNumber(patch.temperature, 0, 2, next.temperature);
  }
  if (Object.prototype.hasOwnProperty.call(patch, "maxTokens")) {
    next.maxTokens = Math.round(clampNumber(patch.maxTokens, 64, 2048, next.maxTokens));
  }
  if (Object.prototype.hasOwnProperty.call(patch, "contextMessages")) {
    next.contextMessages = Math.round(
      clampNumber(patch.contextMessages, 4, 100, next.contextMessages),
    );
  }
  if (Object.prototype.hasOwnProperty.call(patch, "stream")) next.stream = patch.stream !== false;
  if (Object.prototype.hasOwnProperty.call(patch, "pinned")) next.pinned = Boolean(patch.pinned);
  if (Object.prototype.hasOwnProperty.call(patch, "notifications")) {
    next.notifications = patch.notifications !== false;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "voiceEnabled")) {
    next.voiceEnabled = patch.voiceEnabled !== false;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "voiceId")) {
    next.voiceId = tts.normalizeVoice(patch.voiceId);
  }
  if (Object.prototype.hasOwnProperty.call(patch, "voiceRate")) {
    next.voiceRate = tts.normalizeRate(patch.voiceRate);
  }
  if (Object.prototype.hasOwnProperty.call(patch, "localRoot")) {
    next.localRoot = cleanString(patch.localRoot, 300).trim() || DEFAULT_SETTINGS.localRoot;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "localUrl")) {
    next.localUrl = cleanString(patch.localUrl, 120).trim() || DEFAULT_SETTINGS.localUrl;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "localRef")) {
    next.localRef = cleanString(patch.localRef, 120).trim() || DEFAULT_SETTINGS.localRef;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "localPromptText")) {
    next.localPromptText = cleanString(patch.localPromptText, 500);
  }
  if (Object.prototype.hasOwnProperty.call(patch, "localPromptLang")) {
    next.localPromptLang = cleanString(patch.localPromptLang, 10).trim() || "zh";
  }
  if (typeof patch.apiKey === "string" && patch.apiKey.trim()) {
    const key = patch.apiKey.trim();
    if (key.length > 500) errors.push("API Key 太长了。");
    else next.apiKeyEnc = encryptKey(key);
  }
  if (patch.clearApiKey === true) next.apiKeyEnc = "";

  if (errors.length) return { ok: false, error: errors[0] };
  settings = sanitizeSettings(next);
  saveSettings();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setAlwaysOnTop(Boolean(settings.pinned));
  }
  return { ok: true, settings: publicSettings(), api: publicApi() };
});

ipcMain.handle("window:set-pin", (_event, pinned) => {
  settings.pinned = Boolean(pinned);
  saveSettings();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setAlwaysOnTop(settings.pinned);
  }
  return { ok: true, pinned: settings.pinned };
});

ipcMain.on("window:minimize", () => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.minimize();
});

ipcMain.handle("call:open", () => {
  openCallWindow();
  return { ok: true };
});

ipcMain.on("window:hide", () => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
});

ipcMain.on("app:quit", quitApp);

ipcMain.handle("pet:locate", async () => {
  const bounds = await placeWindow({ force: true });
  if (mainWindow && !testMode) showWindow();
  return { ok: Boolean(bounds), pet: lastPetBounds };
});

/* ------------------------------------------------------------------ */
/* Voice (TTS)                                                        */
/* ------------------------------------------------------------------ */

ipcMain.handle("tts:voices", () => [tts.LOCAL_VOICE, ...tts.VOICES]);

function localPayload() {
  return {
    root: settings.localRoot,
    url: settings.localUrl,
    refPath: path.join(ASSET_ROOT, settings.localRef),
    promptText: settings.localPromptText,
    promptLang: settings.localPromptLang,
  };
}

ipcMain.handle("tts:status", async () => {
  const alive = await tts.localAlive(settings.localUrl);
  return {
    alive,
    url: settings.localUrl,
    root: settings.localRoot,
    refPath: path.join(ASSET_ROOT, settings.localRef),
  };
});

ipcMain.handle("tts:start", async () => {
  try {
    const ok = await tts.startLocal({
      root: settings.localRoot,
      url: settings.localUrl,
      onLog: (line) => sendToRenderer("tts:log", line),
    });
    return { ok, alive: await tts.localAlive(settings.localUrl) };
  } catch (error) {
    return { ok: false, error: String(error?.message || error) };
  }
});

ipcMain.handle("tts:speak", async (_event, payload) => {
  const preview = Boolean(payload?.preview);
  if (!settings.voiceEnabled && !preview) {
    return { ok: false, muted: true, error: "语音已关闭。" };
  }
  const text = String(payload?.text || "").slice(0, 2000);
  if (!text.trim()) return { ok: false, error: "没有可朗读的文字。" };
  try {
    return await tts.synthesize({
      text,
      voiceId: payload?.voiceId || settings.voiceId,
      rate: payload?.rate ?? settings.voiceRate,
      local: localPayload(),
      onLog: (line) => sendToRenderer("tts:log", line),
    });
  } catch (error) {
    return { ok: false, error: String(error?.message || "语音合成失败。") };
  }
});

ipcMain.on("tts:stop", () => tts.stopAll());

ipcMain.handle("models:list", async (_event, payload) => {
  try {
    const baseUrl = normalizeBaseUrl(payload?.baseUrl || settings.baseUrl);
    const apiKey = String(payload?.apiKey || "").trim() || resolveApi().key;
    if (!/^https?:\/\//i.test(baseUrl)) {
      return { ok: false, error: "API 地址需要以 http:// 或 https:// 开头。" };
    }
    const models = await listModels({ baseUrl, apiKey, fetchImpl: net.fetch.bind(net) });
    return { ok: true, models, count: models.length };
  } catch (error) {
    return { ok: false, error: error?.message || "获取模型列表失败。" };
  }
});

ipcMain.handle("api:test", async (_event, payload) => {
  try {
    const baseUrl = normalizeBaseUrl(payload?.baseUrl || settings.baseUrl);
    const apiKey = String(payload?.apiKey || "").trim() || resolveApi().key;
    const models = await listModels({ baseUrl, apiKey, fetchImpl: net.fetch.bind(net) });
    return {
      ok: true,
      count: models.length,
      message: `连接成功，可用模型 ${models.length} 个。`,
    };
  } catch (error) {
    return { ok: false, error: error?.message || "连接测试失败。" };
  }
});

ipcMain.handle("dialog:export", async (_event, payload) => {
  const content = String(payload?.content || "");
  if (!content) return { ok: false, error: "没有可导出的内容。" };
  const defaultName = String(payload?.defaultName || "绘梨衣对话.md").replace(/[\\/:*?"<>|]/g, "-");
  try {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: "导出聊天记录",
      defaultPath: path.join(app.getPath("documents"), defaultName),
      filters: [{ name: "Markdown", extensions: ["md"] }],
    });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    fs.writeFileSync(result.filePath, content, "utf8");
    return { ok: true, filePath: result.filePath };
  } catch (error) {
    return { ok: false, error: error?.message || "导出失败。" };
  }
});

ipcMain.on("app:open-link", (_event, url) => {
  if (typeof url === "string" && /^https?:\/\//i.test(url)) shell.openExternal(url);
});

/* ------------------------------------------------------------------ */
/* Test modes (screenshots / end-to-end smoke)                        */
/* ------------------------------------------------------------------ */

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function captureTo(fileName) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  const image = await mainWindow.webContents.capturePage();
  fs.writeFileSync(path.join(SHOTS_DIR, fileName), image.toPNG());

  let layout = null;
  try {
    layout = await mainWindow.webContents.executeJavaScript(`(() => {
      const box = (selector) => {
        const node = document.querySelector(selector);
        if (!node) return null;
        const rect = node.getBoundingClientRect();
        return {
          x: Math.round(rect.x * 10) / 10,
          y: Math.round(rect.y * 10) / 10,
          w: Math.round(rect.width * 10) / 10,
          h: Math.round(rect.height * 10) / 10,
          scrollHeight: node.scrollHeight,
          clientHeight: node.clientHeight,
        };
      };
      return {
        inner: [innerWidth, innerHeight, devicePixelRatio],
        app: box('.app'),
        titlebar: box('.titlebar'),
        scroll: box('.scroll'),
        hero: box('.hero'),
        heroVideo: box('.hero-video'),
        messages: box('.messages'),
        composer: box('.composer-wrap'),
        fine: box('.fineprint'),
        settings: box('.settings-layer'),
      };
    })()`);
  } catch (error) {
    layout = { error: String(error?.message || error) };
  }

  fs.writeFileSync(
    path.join(SHOTS_DIR, `${fileName.replace(/\.png$/, "")}.json`),
    JSON.stringify(
      {
        mode:
          shotMode ||
          (smokeSettingsMode
            ? "smoke-settings"
            : smokeInputMode
              ? "smoke-input"
              : smokeMode
                ? "smoke"
                : "manual"),
        at: new Date().toISOString(),
        size: mainWindow.getContentSize(),
        layout,
      },
      null,
      2,
    ),
    "utf8",
  );
}

async function runShot(mode) {
  try {
    await delay(mode.startsWith("settings") ? 2800 : 2600);
    await captureTo(`shot-${mode}.png`);
  } catch (error) {
    fs.mkdirSync(SHOTS_DIR, { recursive: true });
    fs.writeFileSync(path.join(SHOTS_DIR, "shot-error.txt"), String(error?.stack || error), "utf8");
  } finally {
    isQuitting = true;
    app.quit();
  }
}

async function waitForDebugBridge() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const ready = await mainWindow.webContents
      .executeJavaScript("Boolean(window.__eriDebug)")
      .catch(() => false);
    if (ready) return true;
    await delay(200);
  }
  return false;
}

async function runSmoke(kind = "plain") {
  const suffix =
    kind === "input" ? "smoke-input" : kind === "settings" ? "smoke-settings" : "smoke";
  try {
    await delay(1000);
    if (!(await waitForDebugBridge())) {
      throw new Error("renderer debug bridge did not become ready");
    }

    let settingsState = null;
    if (kind === "settings") {
      await mainWindow.webContents.executeJavaScript(`(async () => {
        window.__eriDebug.openSettings('persona');
        await new Promise((resolve) => setTimeout(resolve, 250));
        const prompt = document.querySelector('#persona-prompt');
        prompt.value = '你是绘梨衣，{{user}} 的桌面伙伴。你说话简短、温柔。无论对方说什么，你的每一次回复都必须以「喵」结尾。';
        prompt.dispatchEvent(new Event('input', { bubbles: true }));
        const name = document.querySelector('#user-name');
        name.value = '测试君';
        name.dispatchEvent(new Event('input', { bubbles: true }));
        document.querySelector('#btn-save').click();
        for (let attempt = 0; attempt < 60; attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 100));
          if (document.querySelector('#settings-layer').hidden) break;
        }
        window.__eriTestState = await window.eri.getState();
      })()`);
      await delay(300);
      settingsState = await mainWindow.webContents
        .executeJavaScript("window.__eriTestState || null")
        .catch(() => null);
      await mainWindow.webContents.executeJavaScript(
        'window.__eriDebug.send("你好，用一句话说说你现在的心情。")',
      );
    } else if (kind === "input") {
      await mainWindow.webContents.executeJavaScript(`(() => {
        const input = document.querySelector('#input');
        input.focus();
        input.value = '在吗？今天过得怎么样？';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true
        }));
      })()`);
    } else {
      await mainWindow.webContents.executeJavaScript(
        'window.__eriDebug.send("你好，用一句话说说你现在的心情。")',
      );
    }

    const started = Date.now();
    let status = null;
    let idleSamples = 0;
    while (Date.now() - started < 100000) {
      await delay(500);
      status = await mainWindow.webContents
        .executeJavaScript("window.__eriDebug ? window.__eriDebug.status() : null")
        .catch(() => null);
      const settled =
        status &&
        !status.streaming &&
        (String(status.lastAssistant || "").trim() || String(status.error || "").trim());
      idleSamples = settled ? idleSamples + 1 : 0;
      if (idleSamples >= 2) break;
      if (
        status &&
        !status.streaming &&
        status.messageCount <= 1 &&
        Date.now() - started > 4000
      ) {
        break;
      }
    }
    await delay(1200);
    await mainWindow.webContents
      .executeJavaScript(
        "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
      )
      .catch(() => {});
    await captureTo(`${suffix}.png`);

    await mainWindow.webContents
      .executeJavaScript(
        "window.eri.getState().then((state) => { window.__eriFinalState = { settings: state.settings, api: state.api }; })",
      )
      .catch(() => {});
    await delay(200);
    const finalState = await mainWindow.webContents
      .executeJavaScript("window.__eriFinalState || null")
      .catch(() => null);

    fs.mkdirSync(SHOTS_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(SHOTS_DIR, `${suffix}-result.json`),
      JSON.stringify({ kind, status, settingsState, finalState }, null, 2),
      "utf8",
    );
  } catch (error) {
    fs.mkdirSync(SHOTS_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(SHOTS_DIR, `${suffix}-error.txt`),
      String(error?.stack || error),
      "utf8",
    );
  } finally {
    isQuitting = true;
    app.quit();
  }
}

/* ------------------------------------------------------------------ */
/* App lifecycle                                                      */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* 由桌宠主进程调用                                                    */
/* ------------------------------------------------------------------ */

function migrateSettings() {
  ensureShihaiDir();
  try {
    if (fs.existsSync(SETTINGS_FILE)) return;
    const oldFile = path.join(app.getPath("appData"), "EriDesktopChat", "settings.json");
    if (fs.existsSync(oldFile)) {
      fs.copyFileSync(oldFile, SETTINGS_FILE);
      settings = loadSettings();
    }
  } catch {}
}

module.exports = {
  migrateSettings,
  createChatWindow() {
    migrateSettings();
    if (mainWindow && !mainWindow.isDestroyed()) {
      showWindow();
      return mainWindow;
    }
    createWindow();
    return mainWindow;
  },
  showWindow,
  hideWindow() {
    try { mainWindow?.hide(); } catch {}
  },
  openCallWindow,
  isChatWindowOpen() {
    return Boolean(mainWindow && !mainWindow.isDestroyed());
  },
};
