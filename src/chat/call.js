"use strict";

const BASE = "http://127.0.0.1:8890";
const avatar = document.getElementById("avatar");
const glow = document.getElementById("glow");
const mouth = document.getElementById("mouth");
const statusEl = document.getElementById("status");
const dot = document.getElementById("dot");
const userLine = document.getElementById("user-line");
const replyLine = document.getElementById("reply-line");
const hint = document.getElementById("hint");
const hangup = document.getElementById("hangup");

const STATUS_TEXT = {
  idle: "空闲",
  loading: "正在准备…",
  listening: "在听你说",
  thinking: "在想…",
  speaking: "说话中",
  stopped: "已结束",
  error: "出错了",
};

let connected = false;
let lastLevel = 0;

async function getState() {
  const res = await fetch(BASE + "/state", { cache: "no-store" });
  if (!res.ok) throw new Error("bad status");
  return res.json();
}

async function post(path) {
  try {
    await fetch(BASE + path, { method: "POST" });
  } catch {}
}

function render(state) {
  connected = true;
  const status = state.status || "idle";
  statusEl.textContent = STATUS_TEXT[status] || status;
  dot.className = "dot" + (status === "speaking" ? " live" : status === "thinking" || status === "loading" ? " think" : "");

  if (state.user) userLine.textContent = "你：" + state.user;
  if (state.reply) replyLine.textContent = state.reply;

  const level = Number(state.level) || 0;
  lastLevel = lastLevel * 0.6 + level * 0.4;
  avatar.style.transform = `scale(${(1 + lastLevel * 0.035).toFixed(3)})`;
  glow.style.opacity = String(0.45 + lastLevel * 0.5);
  mouth.style.opacity = String(Math.min(1, lastLevel * 2.2));
  mouth.style.transform = `scaleY(${(1 + lastLevel * 3.2).toFixed(2)})`;

  if (status === "loading" && state.asr_ready === false) {
    hint.textContent = "正在准备识别模型，约 15 秒…";
  } else if (status === "listening") hint.textContent = "说话就行，她听完会接话";
  else if (status === "speaking") hint.textContent = "她说话时你开口，她会停下来";
  else if (status === "thinking") hint.textContent = "她在想怎么回你";
  else if (status === "loading") hint.textContent = "正在准备识别模型，约 15 秒…";
  else hint.textContent = "";
}

async function tick() {
  try {
    const state = await getState();
    render(state);
  } catch {
    if (connected) {
      connected = false;
      statusEl.textContent = "连接断开";
      dot.className = "dot";
      hint.textContent = "语音服务没响应，检查 call_server.py 是否在跑";
    } else {
      statusEl.textContent = "连接中…";
      hint.textContent = "正在连接语音服务…";
    }
  }
}

const startOverlay = document.getElementById("startoverlay");
const startBtn = document.getElementById("startbtn");

async function begin() {
  startOverlay.classList.remove("hidden");
  startBtn.addEventListener("click", async () => {
    startBtn.disabled = true;
    startBtn.textContent = "正在开始…";
    await expectStart();
    startOverlay.classList.add("hidden");
  });
}

async function expectStart() {
  // 服务端可能还在加载，重试几次
  for (let i = 0; i < 40; i += 1) {
    try {
      const res = await fetch(BASE + "/start", { method: "POST" });
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
}

hangup.addEventListener("click", async () => {
  hangup.disabled = true;
  hangup.textContent = "挂断中…";
  await post("/stop");
  window.close();
});

window.addEventListener("beforeunload", () => {
  try {
    fetch(BASE + "/stop", { method: "POST", keepalive: true });
  } catch {}
});

setInterval(tick, 180);
tick();
begin();
