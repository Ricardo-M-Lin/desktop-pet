"use strict";

/* ------------------------------------------------------------------ */
/* 语音合成                                                            */
/*  - local : 本机 GPT-SoVITS（微调后的绘梨衣声线，断网可用）           */
/*  - edge  : 微软 Edge 在线语音（免费、无需密钥，作为备用）             */
/* ------------------------------------------------------------------ */

const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const net = require("node:net");
const http = require("node:http");
const crypto = require("node:crypto");
const { execFile, spawn } = require("node:child_process");

const VOICES = [
  {
    id: "zh-CN-XiaoxiaoNeural",
    label: "晓晓 · 温柔女声",
    hint: "在线音色，声音偏暖、语速自然",
  },
  {
    id: "zh-CN-XiaoyiNeural",
    label: "晓伊 · 少女",
    hint: "在线音色，更年轻、更活泼",
  },
  {
    id: "zh-CN-YunxiNeural",
    label: "云希 · 少年男声",
    hint: "在线音色，清爽的少年音",
  },
  {
    id: "zh-CN-YunyangNeural",
    label: "云扬 · 男声",
    hint: "在线音色，播音腔",
  },
];

const LOCAL_VOICE = {
  id: "local",
  label: "本机 · 绘梨衣（GPT-SoVITS）",
  hint: "用本机微调模型合成，断网也能说话",
};

const DEFAULT_VOICE = LOCAL_VOICE.id;
const CACHE_DIR = path.join(os.tmpdir(), "eri-chat-tts");
const MAX_CHARS = 600;
const SYNTH_TIMEOUT_MS = 30000;

const running = new Set();
let pythonPromise = null;
let localStarting = null;

function pythonCandidates() {
  return [
    process.env.ERI_PYTHON,
    path.join(os.homedir(), "AppData", "Local", "Programs", "Python", "Python312", "python.exe"),
    "python",
    "py",
  ].filter(Boolean);
}

function normalizeVoice(id) {
  const value = String(id || "").trim();
  if (value === LOCAL_VOICE.id) return LOCAL_VOICE.id;
  return VOICES.some((voice) => voice.id === value) ? value : DEFAULT_VOICE;
}

function normalizeRate(rate) {
  const value = Number(rate);
  if (!Number.isFinite(value)) return 0;
  return Math.min(50, Math.max(-50, Math.round(value)));
}

function formatRate(rate) {
  const value = normalizeRate(rate);
  return `${value >= 0 ? "+" : ""}${value}%`;
}

function run(file, args, timeout) {
  return new Promise((resolve, reject) => {
    const child = execFile(file, args, { timeout, windowsHide: true }, (error, stdout, stderr) => {
      running.delete(child);
      if (error) {
        const detail = String(stderr || "").trim().split(/\r?\n/).slice(-2).join(" ");
        reject(new Error(detail || error.message));
        return;
      }
      resolve({ stdout, stderr });
    });
    running.add(child);
  });
}

function resolvePython() {
  if (pythonPromise) return pythonPromise;
  pythonPromise = (async () => {
    for (const candidate of pythonCandidates()) {
      try {
        await run(candidate, ["-c", "import edge_tts"], 15000);
        return candidate;
      } catch {}
    }
    throw new Error("没有找到可用的在线语音环境（Python + edge-tts）。");
  })();
  pythonPromise.catch(() => {
    pythonPromise = null;
  });
  return pythonPromise;
}

/** 把回复文本整理成适合朗读的纯文本 */
function prepare(text) {
  return String(text || "")
    .replace(/```[\s\S]*?```/g, "。")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s*/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/[*_~#>|]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function prune(folder) {
  try {
    const files = fs
      .readdirSync(folder)
      .filter((name) => name.endsWith(".mp3") || name.endsWith(".wav"))
      .map((name) => {
        const full = path.join(folder, name);
        return { full, time: fs.statSync(full).mtimeMs };
      })
      .sort((a, b) => b.time - a.time);
    for (const item of files.slice(220)) {
      try {
        fs.unlinkSync(item.full);
      } catch {}
    }
  } catch {}
}

function cacheKey(prefix, value) {
  return crypto.createHash("sha1").update(value).digest("hex") + prefix;
}

function toDataUrl(file, mime) {
  const buffer = fs.readFileSync(file);
  return `data:${mime};base64,${buffer.toString("base64")}`;
}

/* ------------------------------------------------------------------ */
/* 本机 GPT-SoVITS                                                     */
/* ------------------------------------------------------------------ */

function localPaths(root) {
  const base = String(root || "").trim();
  if (!base) return null;
  return {
    root: base,
    repo: path.join(base, "GPT-SoVITS"),
    python: path.join(base, ".venv", "Scripts", "python.exe"),
  };
}

/** 直接 TCP 探活，绕开系统代理（本机地址不该走代理） */
function localAlive(url, timeoutMs = 1500) {
  return new Promise((resolve) => {
    let target;
    try {
      target = new URL(url);
    } catch {
      resolve(false);
      return;
    }
    const port = Number(target.port || (target.protocol === "https:" ? 443 : 80));
    const socket = net.connect({ host: target.hostname, port });
    let settled = false;
    const done = (ok) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

/** 用 node:http 直连本机服务（同样绕开代理） */
function requestJson(url, payload, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const body = Buffer.from(JSON.stringify(payload), "utf8");
    const req = http.request(
      {
        host: target.hostname,
        port: Number(target.port || 80),
        path: target.pathname + target.search,
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": body.length },
        timeout: timeoutMs,
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const buffer = Buffer.concat(chunks);
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve(buffer);
          } else {
            reject(new Error(`服务返回 ${res.statusCode}：${buffer.toString("utf8").slice(0, 160)}`));
          }
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("语音服务响应超时")));
    req.on("error", reject);
    req.end(body);
  });
}

async function ensureLocalRunning({ root, url, onLog }) {
  if (await localAlive(url)) return true;
  if (localStarting) return localStarting;

  const paths = localPaths(root);
  if (!paths || !fs.existsSync(paths.python) || !fs.existsSync(path.join(paths.repo, "api_v2.py"))) {
    throw new Error("没有找到本机语音服务目录，请检查设置 → 声音里的服务路径。");
  }

  localStarting = (async () => {
    if (onLog) onLog("正在启动本机语音服务…");
    const child = spawn(
      paths.python,
      ["-s", "api_v2.py", "-a", "127.0.0.1", "-p", new URL(url).port || "9880",
       "-c", "GPT_SoVITS/configs/tts_infer.yaml"],
      { cwd: paths.repo, windowsHide: true, detached: true, stdio: "ignore" },
    );
    child.unref();
    const deadline = Date.now() + 180000;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      if (await localAlive(url)) return true;
    }
    throw new Error("语音服务启动超时，请手动双击「启动语音服务.cmd」。");
  })();

  try {
    return await localStarting;
  } finally {
    localStarting = null;
  }
}

async function synthesizeLocal({ text, url, root, refPath, promptText, promptLang, speed, onLog }) {
  await ensureLocalRunning({ root, url, onLog });
  const body = prepare(text).slice(0, MAX_CHARS);
  if (!body) return { ok: false, error: "没有可朗读的文字。" };
  if (!refPath || !fs.existsSync(refPath)) {
    throw new Error("缺少参考音频，请检查设置 → 声音里的参考音频路径。");
  }
  const payload = {
    text: body,
    text_lang: "zh",
    ref_audio_path: refPath,
    prompt_text: String(promptText || ""),
    prompt_lang: String(promptLang || "zh"),
    text_split_method: "cut5",
    batch_size: 1,
    media_type: "wav",
    streaming_mode: false,
    speed_factor: Number(speed) || 1,
  };
  const buffer = await requestJson(`${url}/tts`, payload, 120000);
  const key = cacheKey(".wav", `${url}|${refPath}|${body}|${speed}`);
  const file = path.join(CACHE_DIR, key);
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(file, buffer);
  prune(CACHE_DIR);
  return { ok: true, audio: toDataUrl(file, "audio/wav"), bytes: buffer.length, engine: "local" };
}

/* ------------------------------------------------------------------ */
/* Microsoft Edge 在线语音                                             */
/* ------------------------------------------------------------------ */

async function synthesizeEdge({ text, voiceId, rate }) {
  const clean = prepare(text);
  if (!clean) return { ok: false, error: "没有可朗读的文字。" };

  const voice = normalizeVoice(voiceId);
  const rateText = formatRate(rate);
  const body = clean.slice(0, MAX_CHARS);
  const key = cacheKey(".mp3", `${voice}|${rateText}|${body}`);
  const file = path.join(CACHE_DIR, key);

  try {
    if (fs.existsSync(file) && fs.statSync(file).size > 800) {
      return {
        ok: true,
        audio: toDataUrl(file, "audio/mpeg"),
        bytes: fs.statSync(file).size,
        cached: true,
        voice,
        rate: rateText,
        engine: "edge",
      };
    }
  } catch {}

  fs.mkdirSync(CACHE_DIR, { recursive: true });
  prune(CACHE_DIR);

  const python = await resolvePython();
  await run(
    python,
    ["-m", "edge_tts", "--voice", voice, "--rate", rateText, "--text", body, "--write-media", file],
    SYNTH_TIMEOUT_MS,
  );

  if (!fs.existsSync(file) || fs.statSync(file).size < 200) {
    throw new Error("语音合成没有产出音频，可能是网络被挡住了。");
  }

  return {
    ok: true,
    audio: toDataUrl(file, "audio/mpeg"),
    bytes: fs.statSync(file).size,
    cached: false,
    voice,
    rate: rateText,
    engine: "edge",
  };
}

/* ------------------------------------------------------------------ */

async function synthesize({ text, voiceId, rate, local, onLog }) {
  const voice = normalizeVoice(voiceId);
  if (voice === LOCAL_VOICE.id) {
    return synthesizeLocal({
      text,
      url: local?.url || "http://127.0.0.1:9880",
      root: local?.root,
      refPath: local?.refPath,
      promptText: local?.promptText,
      promptLang: local?.promptLang,
      speed: 1 + normalizeRate(rate) / 100,
      onLog,
    });
  }
  return synthesizeEdge({ text, voiceId: voice, rate });
}

function stopAll() {
  for (const child of running) {
    try {
      child.kill();
    } catch {}
  }
  running.clear();
}

module.exports = {
  VOICES,
  LOCAL_VOICE,
  DEFAULT_VOICE,
  localPaths,
  localAlive,
  startLocal: ensureLocalRunning,
  synthesize,
  prepare,
  normalizeVoice,
  normalizeRate,
  stopAll,
};
