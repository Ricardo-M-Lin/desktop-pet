const path = require("node:path");
const http = require("node:http");
const fs = require("node:fs");
const { spawn } = require("node:child_process");
const { app, BrowserWindow, Menu, screen, dialog } = require("electron");
// The development Electron bundle is inside a user workspace whose Windows
// ACL does not grant AppContainer read access. Keep the renderer unsandboxed
// so the local prototype can start without changing system ACLs.
app.commandLine.appendSwitch("no-sandbox");
// Give this Electron app its own user-data/instance-lock namespace so other
// Electron applications on the desktop cannot block the pet from starting.
app.setName("绘梨衣桌宠");
const idleLayout = require("../assets/idle-layout.json");
const walkLeftLayout = require("../assets/walk-left-layout.json");
const walkRightLayout = require("../assets/walk-right-layout.json");
const turnRightLeftLayout = require("../assets/turn-right-left-layout.json");
const turnLeftRightLayout = require("../assets/turn-left-right-layout.json");

let petWindow;
let autoWalkTimer;
let petMode = "idle";
let autoDirection = -1;
let autoPauseUntil = 0;
let idleUntil = 0;
let expectedPosition;
let turningUntil = 0;
const turnDurationMs = 2250;
let fixedIdle = false;
const baseDisplayWidth = Math.max(
  idleLayout.displayWidth,
  walkLeftLayout.displayWidth,
  walkRightLayout.displayWidth,
  turnRightLeftLayout.displayWidth,
  turnLeftRightLayout.displayWidth,
);
const basePadding = idleLayout.padding;
const baseWindowWidth = baseDisplayWidth + basePadding * 2;
const baseWindowHeight = idleLayout.displayHeight + basePadding * 2;


/* 她在说话时，桌宠停下来、站定，不打断 */
let petSpeaking = false;

function pollCallState() {
  const req = http.get(
    { host: "127.0.0.1", port: 8890, path: "/state", timeout: 800 },
    (res) => {
      let body = "";
      res.on("data", (c) => { body += c; });
      res.on("end", () => {
        try {
          const st = JSON.parse(body);
          petSpeaking = st.status === "speaking";
        } catch {}
      });
    },
  );
  req.on("error", () => { petSpeaking = false; });
  req.on("timeout", () => { req.destroy(); petSpeaking = false; });
}

function shapeForLayout(layout) {
  const offsetX = Math.round((baseDisplayWidth - layout.displayWidth) / 2);
  return layout.shape.map((rect) => ({ ...rect, x: rect.x + offsetX }));
}

function layoutForMode(mode) {
  if (mode === "walk-left") return walkLeftLayout;
  if (mode === "walk-right") return walkRightLayout;
  if (mode === "turn-right-left") return turnRightLeftLayout;
  if (mode === "turn-left-right") return turnLeftRightLayout;
  return idleLayout;
}

function setPetMode(mode) {
  if (!petWindow || petMode === mode) return;
  petMode = mode;
  const layout = layoutForMode(mode);
  petWindow.setShape(shapeForLayout(layout));
  petWindow.webContents.send("desktop-pet:state", mode);
}

function startTurn(nextDirection) {
  autoDirection = nextDirection;
  turningUntil = Date.now() + turnDurationMs;
  // The turn clip already starts with the current side profile and contains
  // its own front-facing phase. Switch directly to it so a separate idle
  // frame cannot flash between walking and turning.
  setPetMode(nextDirection > 0 ? "turn-left-right" : "turn-right-left");
}

function parkInIdle(workArea, width) {
  if (!petWindow || petWindow.isDestroyed()) return;
  fixedIdle = true;
  autoPauseUntil = 0;
  idleUntil = 0;
  expectedPosition = undefined;
  setPetMode("idle");
  const x = workArea.x + workArea.width - width - 24;
  const y = workArea.y + workArea.height - baseWindowHeight - 24;
  petWindow.setPosition(Math.max(workArea.x, x), Math.max(workArea.y, y));
}

function resumeAutoWalk() {
  fixedIdle = false;
  autoDirection = -1;
  autoPauseUntil = Date.now() + 300;
  idleUntil = 0;
  expectedPosition = undefined;
}

function startAutoWalk(workArea, width) {
  clearInterval(autoWalkTimer);
  autoPauseUntil = Date.now() + 1000;
  autoWalkTimer = setInterval(() => {
    if (!petWindow || petWindow.isDestroyed()) return;
    if (petSpeaking) {
      setPetMode("idle");
      return;
    }
    const [x, y] = petWindow.getPosition();

    if (expectedPosition && (Math.abs(x - expectedPosition[0]) > 3 || Math.abs(y - expectedPosition[1]) > 3)) {
      autoPauseUntil = Date.now() + 1800;
      expectedPosition = undefined;
      idleUntil = Date.now() + 300;
      setPetMode("idle");
    }

    if (fixedIdle) {
      if (petMode !== "idle") setPetMode("idle");
      expectedPosition = undefined;
      return;
    }

    if (Date.now() < autoPauseUntil) return;

    if (petMode === "turn-left-right" || petMode === "turn-right-left") {
      if (Date.now() >= turningUntil) {
        // The last turn frame is already the outgoing side profile. Continue
        // directly into the matching walking loop without a front-pose flash.
        setPetMode(autoDirection < 0 ? "walk-left" : "walk-right");
      }
      return;
    }

    const minX = workArea.x + 12;
    const maxX = workArea.x + workArea.width - width - 12;
    if (x <= minX && autoDirection < 0) {
      startTurn(1);
      return;
    } else if (x >= maxX && autoDirection > 0) {
      startTurn(-1);
      return;
    }

    if (Date.now() < idleUntil) return;

    setPetMode(autoDirection < 0 ? "walk-left" : "walk-right");
    const nextX = x + autoDirection;
    expectedPosition = [nextX, y];
    petWindow.setPosition(nextX, y);
  }, 33);
}

let callWindow;
const CALL_SERVER_PORT = 8890;
const CALL_DIR = "C:\\Users\\linjunxin\\Documents\\GPT-SoVITS";

function pingCallServer() {
  return new Promise((resolve) => {
    const req = http.get(
      { host: "127.0.0.1", port: CALL_SERVER_PORT, path: "/health", timeout: 800 },
      (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      },
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function ensureCallServer() {
  if (await pingCallServer()) return true;
  const python = path.join(CALL_DIR, ".venv", "Scripts", "python.exe");
  const script = path.join(CALL_DIR, "call_server.py");
  if (!fs.existsSync(python) || !fs.existsSync(script)) return false;
  try {
    const child = spawn(python, [script], {
      cwd: CALL_DIR,
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();
  } catch {
    return false;
  }
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
    alwaysOnTop: false,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  callWindow.setMenu(null);
  callWindow.loadFile(path.join(__dirname, "../src/call.html"));
  callWindow.once("ready-to-show", () => {
    callWindow.show();
    callWindow.focus();
  });
  callWindow.on("closed", () => {
    callWindow = undefined;
  });
  ensureCallServer().catch(() => {});
}

function openChatWindow(withCall = false) {
  // 对话窗现在直接跑在桌宠进程里，不再启动第二个 Electron
  const chat = require("./chat-backend.cjs");
  chat.createChatWindow();
  if (withCall) {
    setTimeout(() => {
      try { chat.openCallWindow(); } catch {}
    }, 600);
  }
}


function createPetWindow() {
  const { workArea } = screen.getPrimaryDisplay();
  const width = baseWindowWidth;
  const height = baseWindowHeight;

  petWindow = new BrowserWindow({
    width,
    height,
    x: Math.max(workArea.x, workArea.x + workArea.width - width - 24),
    y: Math.max(workArea.y, workArea.y + workArea.height - height - 24),
    frame: false,
    thickFrame: false,
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: false,
    alwaysOnTop: true,
    resizable: false,
    minWidth: 1,
    minHeight: 1,
    movable: true,
    maximizable: false,
    minimizable: false,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });

  const applyWindowShape = () => {
    if (petWindow && (process.platform === "win32" || process.platform === "linux")) {
      // The union of the animation's alpha masks keeps every frame visible.
      // Points outside the character region pass through to the desktop.
      const layout = layoutForMode(petMode);
      petWindow.setShape(shapeForLayout(layout));
    }
  };
  petWindow.on("resize", applyWindowShape);

  petWindow.setMenu(null);
  const contextMenu = Menu.buildFromTemplate([
    { label: "待机（右下角，不自动走动）", click: () => parkInIdle(workArea, width) },
    { label: "恢复自动行走", click: resumeAutoWalk },
    { label: "打开绘梨衣对话", click: () => openChatWindow(false) },
    { label: "视频通话", click: () => openChatWindow(true) },
    { type: "separator" },
    { label: "退出", click: () => app.quit() },
  ]);
  let menuOpen = false;
  const showContextMenu = () => {
    if (petWindow && !petWindow.isDestroyed() && !menuOpen) {
      menuOpen = true;
      contextMenu.popup({ window: petWindow, callback: () => { menuOpen = false; } });
    }
  };

  // Windows treats the character's native drag region as a title bar.
  petWindow.on("system-context-menu", (event) => {
    event.preventDefault();
    showContextMenu();
  });
  petWindow.webContents.on("context-menu", showContextMenu);

  petWindow.loadFile(path.join(__dirname, "../src/index.html"));
  setInterval(pollCallState, 800);
  petWindow.once("ready-to-show", () => {
    applyWindowShape();
    petWindow.show();
    startAutoWalk(workArea, width);
  });
  petWindow.on("closed", () => {
    clearInterval(autoWalkTimer);
    autoWalkTimer = undefined;
    petWindow = undefined;
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    petWindow?.show();
    petWindow?.focus();
  });
  app.whenReady().then(() => {
    createPetWindow();
    // 调试入口：--chat 直接开对话窗，--call 再开视频通话
    if (process.argv.includes("--chat") || process.argv.includes("--call")) {
      setTimeout(() => {
        openChatWindow(process.argv.includes("--call"));
      }, 800);
    }
    if (process.argv.includes("--call")) {
      setTimeout(openCallWindow, 600);
    }
  });
}

app.on("window-all-closed", () => app.quit());

