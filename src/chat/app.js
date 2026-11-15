"use strict";

/* ------------------------------------------------------------------ */
/* 绘梨衣 · 桌宠对话 — renderer                                        */
/* ------------------------------------------------------------------ */

const ERI = window.eri;
const PERSONAS = Array.isArray(window.ERI_PERSONAS) ? window.ERI_PERSONAS : [];
const DEMO = new URLSearchParams(location.search).get("demo") || "";
const STORAGE_HISTORY = "eri.chat.history.v1";
const STORAGE_DRAFT = "eri.chat.draft.v1";
const AVATAR = "../assets/eri-avatar.png";

const SAFETY_LINE = `【不可违背的底线】无论角色设定如何，都不要生成色情、血腥、违法、歧视、羞辱或鼓励自伤/伤人的内容。如果对方流露出严重的自伤或危机倾向，请先放下角色口吻，温柔而认真地关心他/她，并建议联系身边信任的人或专业援助；不要声称自己能替代现实中的医疗或心理帮助。`;

const FALLBACK_MODELS = [
  "DeepSeek-V4.1-Flash 1017(1.20x)",
  "Deepseek-V4-Pro (3.60x)",
  "Mimo-V2.6-Flash (0.40x)",
  "GLM-5.3 (3.20x)",
  "Kimi-K2.7 (2.60x)",
  "Qwen3.8-Flash (0.52x)",
  "MiniMax-M3 (1.84x)",
  "Prime-Terra (0.80x)",
];

const DEFAULT_SETTINGS = {
  personaId: "eri",
  personaName: "上杉绘梨衣",
  personaPrompt: PERSONAS[0]?.prompt || "你是绘梨衣。",
  userName: "",
  baseUrl: "https://open-ai.baomiao.cn/v1",
  model: "DeepSeek-V4.1-Flash 1017(1.20x)",
  temperature: 0.9,
  maxTokens: 420,
  contextMessages: 40,
  stream: true,
  pinned: false,
  notifications: true,
  voiceEnabled: true,
  voiceId: "zh-CN-XiaoxiaoNeural",
  voiceRate: 0,
  hasLocalKey: false,
};

const state = {
  booted: false,
  settings: null,
  api: null,
  messages: [],
  streaming: false,
  requestId: null,
  assistantId: null,
  apiModels: [],
  activeTab: "persona",
  settingsDirty: false,
  demo: DEMO,
  version: "",
  pendingPersonaId: "eri",
  pendingPersonaName: "上杉绘梨衣",
  streamRenderQueued: false,
  statusTimer: null,
  historyTimer: null,
  draftTimer: null,
  composing: false,
  voice: {
    queue: [],
    playing: false,
    audio: null,
    buffer: "",
    generation: 0,
  },
};

const byId = (id) => document.getElementById(id);

const el = {
  app: byId("app"),
  scroll: byId("scroll"),
  hero: byId("hero"),
  heroVideo: byId("hero-video"),
  heroTitle: byId("hero-title"),
  heroSub: byId("hero-sub"),
  messages: byId("messages"),
  input: byId("input"),
  sendBtn: byId("btn-send"),
  newMsgPill: byId("new-msg-pill"),
  titlebar: byId("titlebar"),
  presence: byId("presence"),
  statusDot: byId("status-dot"),
  statusText: byId("status-text"),
  btnCall: byId("btn-call"),
  btnPin: byId("btn-pin"),
  btnSettings: byId("btn-settings"),
  btnMin: byId("btn-min"),
  btnClose: byId("btn-close"),
  chipPersona: byId("chip-persona"),
  chipPersonaLabel: byId("chip-persona-label"),
  chipModel: byId("chip-model"),
  chipModelLabel: byId("chip-model-label"),
  chipVoice: byId("chip-voice"),
  chipVoiceLabel: byId("chip-voice-label"),
  chipVoiceIcon: byId("chip-voice-icon"),
  voiceEnabled: byId("voice-enabled"),
  voiceId: byId("voice-id"),
  voiceHint: byId("voice-hint"),
  voiceRate: byId("voice-rate"),
  voiceRateValue: byId("voice-rate-value"),
  voiceStatus: byId("voice-status"),
  btnVoiceTest: byId("btn-voice-test"),
  ttsStatusText: byId("tts-status-text"),
  btnTtsStart: byId("btn-tts-start"),
  localRoot: byId("local-root"),
  localPrompt: byId("local-prompt"),
  toasts: byId("toasts"),
  settingsLayer: byId("settings-layer"),
  sheet: document.querySelector(".sheet"),
  tabs: Array.from(document.querySelectorAll(".tab")),
  panes: Array.from(document.querySelectorAll(".pane")),
  presetGrid: byId("preset-grid"),
  personaPrompt: byId("persona-prompt"),
  personaCount: byId("persona-count"),
  userName: byId("user-name"),
  sourceDot: byId("source-dot"),
  apiSource: byId("api-source"),
  apiMasked: byId("api-masked"),
  btnUseDsh: byId("btn-use-dsh"),
  baseUrl: byId("base-url"),
  apiKey: byId("api-key"),
  btnEye: byId("btn-eye"),
  modelInput: byId("model-input"),
  modelList: byId("model-list"),
  btnRefresh: byId("btn-refresh"),
  temperature: byId("temperature"),
  tempValue: byId("temp-value"),
  maxTokens: byId("max-tokens"),
  contextMessages: byId("context-messages"),
  stream: byId("stream"),
  btnTest: byId("btn-test"),
  testStatus: byId("test-status"),
  pinned: byId("pinned"),
  notifications: byId("notifications"),
  btnLocate: byId("btn-locate"),
  btnExport: byId("btn-export"),
  btnClear: byId("btn-clear"),
  btnQuit: byId("btn-quit"),
  btnSave: byId("btn-save"),
  saveHint: byId("save-hint"),
  aboutVersion: byId("about-version"),
};

/* ------------------------------------------------------------------ */
/* Utilities                                                          */
/* ------------------------------------------------------------------ */

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function uid() {
  try {
    return crypto.randomUUID();
  } catch {
    return `m-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
}

function debounce(fn, wait) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

const timeFormatter = new Intl.DateTimeFormat("zh-CN", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function formatTime(timestamp) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  return timeFormatter.format(date);
}

function dayKey(timestamp) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function formatDate(timestamp) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const today = dayKey(now.getTime());
  const target = dayKey(timestamp);
  if (target === today) return "今天";
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (target === dayKey(yesterday.getTime())) return "昨天";
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日`;
}

function shortPersonaName(name) {
  const value = String(name || "").trim();
  if (!value) return "上杉绘梨衣";
  const parts = value.split("·");
  return (parts[parts.length - 1] || value).trim();
}

function shortModelName(name) {
  const value = String(name || "");
  const known = [
    [/deepseek/i, "DeepSeek"],
    [/mimo/i, "Mimo"],
    [/glm/i, "GLM"],
    [/kimi/i, "Kimi"],
    [/qwen/i, "Qwen"],
    [/minimax/i, "MiniMax"],
    [/prime/i, "Prime"],
    [/hy4/i, "HY4"],
  ];
  for (const [pattern, label] of known) {
    if (pattern.test(value)) return label;
  }
  const first = value.split(/[\s(（]/)[0];
  return (first || "模型").slice(0, 12);
}

function isNearBottom(threshold = 90) {
  const node = el.scroll;
  return node.scrollHeight - node.scrollTop - node.clientHeight < threshold;
}

function scrollToBottom(behavior = "smooth") {
  el.scroll.scrollTo({ top: el.scroll.scrollHeight, behavior });
}

function addRenderedHtml(html) {
  el.messages.insertAdjacentHTML("beforeend", html);
}

function toast(message, type = "info", duration = 2400) {
  const node = document.createElement("div");
  node.className = `toast ${type === "error" ? "error" : ""}`.trim();
  node.textContent = message;
  el.toasts.appendChild(node);
  while (el.toasts.children.length > 3) el.toasts.firstElementChild?.remove();
  window.setTimeout(() => {
    node.classList.add("leaving");
    window.setTimeout(() => node.remove(), 220);
  }, duration);
}

function setStatus(text, mode = "idle") {
  clearTimeout(state.statusTimer);
  el.statusText.textContent = text;
  el.presence.classList.toggle("typing", mode === "typing");
}

function idleSoon(delay = 1800) {
  clearTimeout(state.statusTimer);
  state.statusTimer = window.setTimeout(() => {
    if (!state.streaming) setStatus("在桌面陪着你");
  }, delay);
}

/* ------------------------------------------------------------------ */
/* Markdown (safe, small subset)                                      */
/* ------------------------------------------------------------------ */

function inlineMarkdown(text) {
  let output = text;
  output = output.replace(/`([^`]+)`/g, "<code>$1</code>");
  output = output.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  output = output.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  output = output.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    '<a href="$2" target="_blank" rel="noreferrer">$1</a>',
  );
  return output;
}

function renderMarkdown(source) {
  const text = String(source || "");
  const escaped = escapeHtml(text);
  const lines = escaped.split("\n");
  let html = "";
  let inCode = false;
  let codeLines = [];
  let listType = null;

  const closeList = () => {
    if (listType) {
      html += `</${listType}>`;
      listType = null;
    }
  };

  for (const rawLine of lines) {
    if (/^```/.test(rawLine)) {
      if (!inCode) {
        closeList();
        inCode = true;
        codeLines = [];
      } else {
        html += `<pre><code>${codeLines.join("\n")}</code></pre>`;
        inCode = false;
        codeLines = [];
      }
      continue;
    }
    if (inCode) {
      codeLines.push(rawLine);
      continue;
    }

    if (/^\s*$/.test(rawLine)) {
      closeList();
      html += '<div class="gap"></div>';
      continue;
    }

    if (/^&gt;\s?/.test(rawLine)) {
      closeList();
      html += `<blockquote>${inlineMarkdown(rawLine.replace(/^&gt;\s?/, ""))}</blockquote>`;
      continue;
    }

    let match = rawLine.match(/^\s*[-*]\s+(.*)$/);
    if (match) {
      if (listType !== "ul") {
        closeList();
        html += "<ul>";
        listType = "ul";
      }
      html += `<li>${inlineMarkdown(match[1])}</li>`;
      continue;
    }

    match = rawLine.match(/^\s*\d+[.)]\s+(.*)$/);
    if (match) {
      if (listType !== "ol") {
        closeList();
        html += "<ol>";
        listType = "ol";
      }
      html += `<li>${inlineMarkdown(match[1])}</li>`;
      continue;
    }

    closeList();
    html += `<p>${inlineMarkdown(rawLine)}</p>`;
  }

  if (inCode) {
    html += `<pre><code>${codeLines.join("\n")}</code></pre>`;
  }
  closeList();
  return html;
}

function renderPlain(text) {
  return escapeHtml(text).replace(/\n/g, "<br>");
}

/* ------------------------------------------------------------------ */
/* History / draft                                                    */
/* ------------------------------------------------------------------ */

function validMessage(message) {
  if (!message || typeof message !== "object") return false;
  if (!["user", "assistant", "note"].includes(message.role)) return false;
  if (typeof message.content !== "string" || !message.content.trim()) return false;
  if (message.content.length > 20000) return false;
  return true;
}

function loadHistory() {
  if (state.demo) return;
  try {
    const raw = localStorage.getItem(STORAGE_HISTORY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed) ? parsed : parsed?.messages;
    if (!Array.isArray(list)) return;
    state.messages = list
      .filter(validMessage)
      .slice(-300)
      .map((message) => ({
        id: typeof message.id === "string" ? message.id : uid(),
        role: message.role,
        content: message.content,
        ts: Number(message.ts) || Date.now(),
        error: typeof message.error === "string" ? message.error : "",
        errorCode: typeof message.errorCode === "string" ? message.errorCode : "",
        pending: false,
      }))
      .filter((message) => !(message.role === "assistant" && !message.content.trim()));
  } catch {
    state.messages = [];
  }
}

function persistHistoryNow() {
  if (state.demo) return;
  try {
    localStorage.setItem(
      STORAGE_HISTORY,
      JSON.stringify({ v: 1, messages: state.messages.slice(-300) }),
    );
  } catch {}
}

function persistHistory() {
  clearTimeout(state.historyTimer);
  state.historyTimer = window.setTimeout(persistHistoryNow, 220);
}

function loadDraft() {
  if (state.demo) return "";
  try {
    return localStorage.getItem(STORAGE_DRAFT) || "";
  } catch {
    return "";
  }
}

function saveDraftNow() {
  if (state.demo) return;
  try {
    const value = el.input.value;
    if (value.trim()) localStorage.setItem(STORAGE_DRAFT, value);
    else localStorage.removeItem(STORAGE_DRAFT);
  } catch {}
}

function saveDraftSoon() {
  clearTimeout(state.draftTimer);
  state.draftTimer = window.setTimeout(saveDraftNow, 260);
}

function clearDraft() {
  clearTimeout(state.draftTimer);
  if (!state.demo) {
    try {
      localStorage.removeItem(STORAGE_DRAFT);
    } catch {}
  }
}

/* ------------------------------------------------------------------ */
/* Rendering                                                          */
/* ------------------------------------------------------------------ */

function updatePinUI() {
  const pinned = Boolean(state.settings?.pinned);
  el.btnPin.classList.toggle("active", pinned);
  el.btnPin.title = pinned ? "取消置顶" : "置顶窗口";
  if (el.pinned) el.pinned.checked = pinned;
}

function renderChrome() {
  if (!state.settings) return;
  el.chipPersonaLabel.textContent = shortPersonaName(state.settings.personaName);
  el.chipPersonaLabel.title = state.settings.personaName || "性格";
  el.chipModelLabel.textContent = shortModelName(state.settings.model);
  el.chipModelLabel.title = state.settings.model || "模型";
  el.chipModel.title = state.settings.model || "切换模型";
  updateVoiceChip();
  updatePinUI();
}

function renderHero() {
  const hasMessages = state.messages.length > 0;
  el.hero.hidden = hasMessages;
  if (!hasMessages) setGreeting();
}

function setGreeting() {
  const hour = new Date().getHours();
  let title = "晚上好。";
  let sub = "今天也辛苦了。要在这里坐一会儿吗？";
  let quote = "你来了。";
  if (hour >= 5 && hour < 11) {
    title = "早上好。";
    sub = "新的一天开始了。先伸个懒腰，再去面对世界吧。";
    quote = "早呀。";
  } else if (hour >= 11 && hour < 14) {
    title = "中午好。";
    sub = "记得吃饭。吃完再来找我也没关系。";
    quote = "吃饭了吗？";
  } else if (hour >= 14 && hour < 18) {
    title = "下午好。";
    sub = "太阳在慢慢往下走。今天还顺利吗？";
    quote = "我在这里。";
  } else if (hour >= 23 || hour < 5) {
    title = "夜深了。";
    sub = "如果困了，就去睡吧。我会安静地待在这里。";
    quote = "还不睡吗？";
  }
  el.heroTitle.textContent = title;
  el.heroSub.textContent = sub;
  const quoteNode = document.querySelector(".hero-quote span");
  if (quoteNode) quoteNode.textContent = quote;
}

function messageMeta(message, isLastAssistant) {
  const copy = `<button class="msg-action" type="button" data-action="copy" title="复制">
      <svg class="ico"><use href="#i-copy"></use></svg>
    </button>`;
  const regen =
    message.role === "assistant" && isLastAssistant && !state.streaming
      ? `<button class="msg-action" type="button" data-action="regen" title="重新回复">
          <svg class="ico"><use href="#i-refresh"></use></svg>
        </button>`
      : "";
  return `<div class="msg-meta"><span>${formatTime(message.ts)}</span>${copy}${regen}</div>`;
}

function assistantAvatar() {
  return `<img class="msg-avatar" src="${AVATAR}" alt="" draggable="false" />`;
}

function renderMessage(message, index) {
  if (message.role === "note") {
    return `<div class="msg-note">${escapeHtml(message.content)}</div>`;
  }

  const isLastAssistant =
    message.role === "assistant" &&
    state.messages
      .slice(index + 1)
      .every((item) => item.role === "note" || item.role === "user");

  const isStreaming =
    state.streaming && message.role === "assistant" && message.id === state.assistantId;
  const classes = ["msg", message.role];
  if (isStreaming) classes.push("streaming");
  if (message.error) classes.push("has-error");

  let body = "";
  if (message.role === "assistant") {
    if (message.error && !message.content) {
      body = `<div class="bubble error">
          <div class="error-title"><svg class="ico"><use href="#i-alert"></use></svg>连接没有成功</div>
          <div class="error-text">${escapeHtml(message.error)}</div>
          <div class="retry-row">
            <button class="mini-action" type="button" data-action="retry">再试一次</button>
            <button class="mini-action" type="button" data-action="settings">检查设置</button>
          </div>
        </div>`;
    } else {
      const content = message.content
        ? renderMarkdown(message.content) + (isStreaming ? '<span class="cursor"></span>' : "")
        : `<span class="typing"><span></span><span></span><span></span></span>`;
      body = `<div class="bubble"><div class="bubble-content">${content}</div></div>`;
      if (message.error) {
        body += `<div class="partial-warning">回复中断：${escapeHtml(message.error)}</div>
          <div class="retry-row">
            <button class="mini-action" type="button" data-action="retry">再试一次</button>
            <button class="mini-action" type="button" data-action="settings">检查设置</button>
          </div>`;
      }
    }
    return `<article class="${classes.join(" ")}" data-id="${message.id}">
        ${assistantAvatar()}
        <div class="msg-body">${body}${messageMeta(message, isLastAssistant)}</div>
      </article>`;
  }

  return `<article class="${classes.join(" ")}" data-id="${message.id}">
      <div class="msg-body">
        <div class="bubble"><div class="bubble-content">${renderPlain(message.content)}</div></div>
        ${messageMeta(message, false)}
      </div>
    </article>`;
}

function renderMessages({ forceScroll = false } = {}) {
  const stick = isNearBottom();
  const previousTop = el.scroll.scrollTop;
  const hadMessages = state.messages.length > 0;

  el.messages.innerHTML = "";
  let lastDate = "";
  state.messages.forEach((message, index) => {
    const key = dayKey(message.ts);
    if (key && key !== lastDate) {
      addRenderedHtml(`<div class="date-sep"><span>${formatDate(message.ts)}</span></div>`);
      lastDate = key;
    }
    addRenderedHtml(renderMessage(message, index));
  });

  renderHero();

  if (!state.messages.length) {
    el.scroll.scrollTop = 0;
    el.newMsgPill.classList.remove("show");
  } else if (forceScroll || (stick && hadMessages)) {
    requestAnimationFrame(() => scrollToBottom("auto"));
  } else {
    el.scroll.scrollTop = previousTop;
  }

  if (!hadMessages) {
    el.newMsgPill.classList.remove("show");
  } else if (stick) {
    el.newMsgPill.classList.remove("show");
  }
}

function updateStreamingBubble() {
  const message = state.messages.find((item) => item.id === state.assistantId);
  if (!message) return;
  const node = el.messages.querySelector(`.msg[data-id="${message.id}"]`);
  if (!node) {
    renderMessages();
    return;
  }
  const bubble = node.querySelector(".bubble");
  if (!bubble) return;
  const stick = isNearBottom();
  bubble.innerHTML = `<div class="bubble-content">${renderMarkdown(
    message.content,
  )}<span class="cursor"></span></div>`;
  if (stick) scrollToBottom("auto");
  else el.newMsgPill.classList.add("show");
}

function scheduleStreamingRender() {
  if (state.streamRenderQueued) return;
  state.streamRenderQueued = true;
  requestAnimationFrame(() => {
    state.streamRenderQueued = false;
    updateStreamingBubble();
  });
}

function autoResizeInput() {
  el.input.style.height = "auto";
  el.input.style.height = `${Math.min(120, Math.max(23, el.input.scrollHeight))}px`;
}

function updateSendButton() {
  if (state.streaming) {
    el.sendBtn.classList.add("is-streaming");
    el.sendBtn.disabled = false;
    el.sendBtn.title = "停止回复";
    el.sendBtn.setAttribute("aria-label", "停止回复");
    return;
  }
  el.sendBtn.classList.remove("is-streaming");
  el.sendBtn.disabled = !el.input.value.trim();
  el.sendBtn.title = "发送 (Enter)";
  el.sendBtn.setAttribute("aria-label", "发送");
}

/* ------------------------------------------------------------------ */
/* Chat                                                               */
/* ------------------------------------------------------------------ */

function buildSystemPrompt() {
  const settings = state.settings || DEFAULT_SETTINGS;
  const preferredName = String(settings.userName || "").trim();
  const userName = preferredName || "你";
  const base = String(settings.personaPrompt || PERSONAS[0]?.prompt || "你是绘梨衣。")
    .replaceAll("{{user}}", userName)
    .replaceAll("{{char}}", "绘梨衣");
  const nameHint = preferredName
    ? `（用户希望你称呼他/她为「${preferredName}」。）\n\n`
    : "";
  return `${base}\n\n${nameHint}${SAFETY_LINE}`;
}

function startAssistantRequest() {
  if (state.streaming) return;
  const lastUser = [...state.messages].reverse().find((message) => message.role === "user");
  if (!lastUser) return;

  stopSpeech();
  const settings = state.settings || DEFAULT_SETTINGS;
  const assistant = {
    id: uid(),
    role: "assistant",
    content: "",
    ts: Date.now(),
    pending: true,
  };
  state.messages.push(assistant);
  state.assistantId = assistant.id;
  state.requestId = uid();
  state.streaming = true;
  setStatus("正在输入…", "typing");
  updateSendButton();
  renderMessages({ forceScroll: true });
  persistHistory();

  const context = state.messages
    .filter(
      (message) =>
        message.id !== assistant.id &&
        (message.role === "user" || message.role === "assistant") &&
        message.content.trim() &&
        !message.error,
    )
    .slice(-Math.max(4, Number(settings.contextMessages) || 40));
  while (context.length && context[0].role === "assistant") context.shift();

  const messages = [
    { role: "system", content: buildSystemPrompt() },
    ...context.map((message) => ({ role: message.role, content: message.content })),
  ];

  ERI.sendChat({
    requestId: state.requestId,
    messages,
    temperature: settings.temperature,
    maxTokens: settings.maxTokens,
    stream: settings.stream !== false,
  });
}

function sendMessage(rawText) {
  if (!state.booted) return;
  if (state.demo) {
    toast("演示模式不会真正发送消息", "info", 1800);
    return;
  }
  const text = String(rawText ?? "").trim();
  if (!text) return;
  stopSpeech();
  if (state.streaming) {
    toast("等她说完这一句吧…", "info", 1600);
    return;
  }
  if (!state.api?.configured) {
    toast("还没有配置 API Key，先打开设置 → 连接。", "error", 3600);
    openSettings("connection");
    return;
  }
  if (!state.settings?.model) {
    toast("还没有选择模型。", "error", 3000);
    openSettings("connection");
    return;
  }

  state.messages.push({
    id: uid(),
    role: "user",
    content: text,
    ts: Date.now(),
  });

  el.input.value = "";
  autoResizeInput();
  clearDraft();
  updateSendButton();
  persistHistory();
  renderMessages();
  el.hero.hidden = true;
  scrollToBottom("smooth");
  startAssistantRequest();
}

function stopStreaming() {
  if (!state.streaming || !state.requestId) return;
  setStatus("正在停下来…");
  ERI.abortChat(state.requestId);
}

function retryAssistant(id) {
  if (state.streaming) return;
  const index = state.messages.findIndex(
    (message) => message.id === id && message.role === "assistant",
  );
  if (index < 0) return;
  state.messages.splice(index, 1);
  persistHistory();
  renderMessages();
  startAssistantRequest();
}

function regenerate(id) {
  if (state.streaming) return;
  const last = state.messages[state.messages.length - 1];
  if (!last || last.id !== id || last.role !== "assistant") return;
  if (!state.messages.some((message) => message.role === "user")) return;
  state.messages.pop();
  persistHistory();
  renderMessages();
  startAssistantRequest();
}

function handleDelta(payload) {
  if (!payload || payload.requestId !== state.requestId) return;
  const message = state.messages.find((item) => item.id === state.assistantId);
  if (!message) return;
  const delta = String(payload.delta || "");
  message.content += delta;
  message.pending = true;
  scheduleStreamingRender();

  if (voiceOn()) {
    state.voice.buffer += delta;
    const { parts, rest } = splitSpeech(state.voice.buffer, false);
    state.voice.buffer = rest;
    for (const part of parts) speakText(part);
  }
}

function finalizeStatusAfterReply() {
  setStatus("在听你说");
  idleSoon(1800);
}

function handleDone(payload) {
  if (!payload || payload.requestId !== state.requestId) return;
  const message = state.messages.find((item) => item.id === state.assistantId);
  state.streaming = false;
  state.requestId = null;
  state.assistantId = null;
  updateSendButton();

  // 把流式内容里没说完的尾巴也念出来
  if (voiceOn()) {
    const { parts } = splitSpeech(state.voice.buffer, true);
    for (const part of parts) speakText(part);
  }
  state.voice.buffer = "";

  if (!message) {
    finalizeStatusAfterReply();
    return;
  }

  message.pending = false;
  if (!message.content.trim()) {
    if (payload.aborted) {
      const index = state.messages.indexOf(message);
      if (index >= 0) state.messages.splice(index, 1);
      state.messages.push({
        id: uid(),
        role: "note",
        content: "她刚要说出口，又轻轻把话咽了回去。",
        ts: Date.now(),
      });
    } else {
      message.error = "她没有说出话来。再试一次吧。";
      message.errorCode = "empty";
    }
  }

  persistHistory();
  renderMessages({ forceScroll: true });
  if (payload.aborted) {
    setStatus("已经停下来了");
    idleSoon(1600);
  } else {
    finalizeStatusAfterReply();
  }
}

function handleError(payload) {
  if (!payload || payload.requestId !== state.requestId) return;
  const message = state.messages.find((item) => item.id === state.assistantId);
  state.streaming = false;
  state.requestId = null;
  state.assistantId = null;
  updateSendButton();

  if (message) {
    message.pending = false;
    if (!message.content && payload.partial) message.content = String(payload.partial);
    message.error = String(payload.message || "连接失败，请稍后再试。");
    message.errorCode = String(payload.code || "error");
  }

  persistHistory();
  renderMessages({ forceScroll: true });
  setStatus("好像有点走神");
  idleSoon(2600);
  toast(payload.message || "连接失败", "error", 3600);
}

async function copyText(text) {
  const value = String(text || "");
  if (!value) return;
  try {
    await navigator.clipboard.writeText(value);
    toast("已复制");
    return;
  } catch {}
  try {
    const helper = document.createElement("textarea");
    helper.value = value;
    helper.style.position = "fixed";
    helper.style.opacity = "0";
    document.body.appendChild(helper);
    helper.select();
    document.execCommand("copy");
    helper.remove();
    toast("已复制");
  } catch {
    toast("复制失败，可以手动选中文字", "error");
  }
}

function copyMessage(id) {
  const message = state.messages.find((item) => item.id === id);
  if (message) copyText(message.content);
}

/* ------------------------------------------------------------------ */
/* Voice                                                              */
/* ------------------------------------------------------------------ */

const SPEECH_END = "。！？!?…\n";
const SPEECH_TRAIL = "。！？!?…～~”’」』）)】》\"'";

const PREVIEW_LINE = "你回来啦。今天也辛苦了，要不要在这儿坐一会儿？";

function stripForSpeech(text) {
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

/** 把流式文本切成可以立刻朗读的句子；flush 时收掉尾巴 */
function splitSpeech(buffer, flush = false) {
  const parts = [];
  let rest = String(buffer || "");
  for (;;) {
    let cut = -1;
    for (let i = 0; i < rest.length; i += 1) {
      if (SPEECH_END.includes(rest[i])) {
        cut = i;
        while (cut + 1 < rest.length && SPEECH_TRAIL.includes(rest[cut + 1])) cut += 1;
        break;
      }
    }
    if (cut < 0) break;
    const piece = rest.slice(0, cut + 1).trim();
    rest = rest.slice(cut + 1);
    if (stripForSpeech(piece)) parts.push(piece);
  }
  if (flush) {
    const tail = rest.trim();
    rest = "";
    if (stripForSpeech(tail)) parts.push(tail);
  }
  return { parts, rest };
}

function voiceOn() {
  return Boolean(state.settings?.voiceEnabled);
}

function updateVoiceChip() {
  if (!el.chipVoice) return;
  const on = voiceOn();
  el.chipVoiceLabel.textContent = on ? "声音开" : "静音";
  el.chipVoice.classList.toggle("muted", !on);
  el.chipVoice.title = on ? "点一下可以安静下来" : "点一下让她重新出声";
  if (el.chipVoiceIcon) el.chipVoiceIcon.setAttribute("href", on ? "#i-volume" : "#i-volume-off");
}

function playAudio(src) {
  return new Promise((resolve) => {
    let settled = false;
    const audio = new Audio(src);
    state.voice.audio = audio;
    const finish = () => {
      if (settled) return;
      settled = true;
      try {
        audio.pause();
      } catch {}
      if (state.voice.audio === audio) state.voice.audio = null;
      resolve();
    };
    audio.onended = finish;
    audio.onerror = finish;
    audio.onpause = finish;
    audio.play().catch(finish);
  });
}

async function pumpSpeech() {
  if (state.voice.playing) return;
  const job = state.voice.queue.shift();
  if (!job) return;
  const generation = state.voice.generation;
  state.voice.playing = true;
  try {
    const result = await ERI.speak({
      text: job.text,
      voiceId: state.settings?.voiceId || DEFAULT_SETTINGS.voiceId,
      rate: Number(state.settings?.voiceRate || 0),
      preview: Boolean(job.preview),
    });
    if (generation !== state.voice.generation) return;
    if (!result?.ok) {
      if (job.preview) toast(result?.error || "语音合成失败。", "error", 4000);
      return;
    }
    await playAudio(result.audio);
  } catch (error) {
    if (job.preview) toast(String(error?.message || error), "error", 4000);
  } finally {
    state.voice.playing = false;
    if (generation === state.voice.generation && state.voice.queue.length) pumpSpeech();
  }
}

function speakText(text, options = {}) {
  if (!options.preview && !voiceOn()) return;
  const clean = stripForSpeech(text).slice(0, 600);
  if (!clean) return;
  state.voice.queue.push({ text: clean, preview: Boolean(options.preview) });
  pumpSpeech();
}

/** 立刻安静：清空队列、掐断正在合成与正在播放的语音 */
function stopSpeech() {
  state.voice.generation += 1;
  state.voice.queue.length = 0;
  state.voice.buffer = "";
  const audio = state.voice.audio;
  state.voice.audio = null;
  if (audio) {
    try {
      audio.pause();
    } catch {}
  }
  state.voice.playing = false;
  try {
    ERI.stopVoice();
  } catch {}
}

async function refreshVoiceStatus() {
  if (!el.ttsStatusText) return;
  el.ttsStatusText.textContent = "正在检测…";
  try {
    const info = await ERI.voiceStatus();
    const alive = Boolean(info?.alive);
    el.ttsStatusText.textContent = alive ? `运行中 · ${info.url}` : "未启动（点右边启动）";
    el.ttsStatusText.style.color = alive ? "var(--gold)" : "";
    if (el.btnTtsStart) {
      el.btnTtsStart.disabled = alive;
      el.btnTtsStart.textContent = alive ? "已启动" : "启动";
    }
    if (info?.root && el.localRoot && !el.localRoot.value) el.localRoot.value = info.root;
  } catch {
    el.ttsStatusText.textContent = "检测失败";
  }
}

async function startVoiceService() {
  if (!el.btnTtsStart) return;
  el.btnTtsStart.disabled = true;
  el.ttsStatusText.textContent = "启动中…首次要加载模型，约 30~60 秒";
  try {
    const result = await ERI.startVoice();
    if (result?.ok) {
      el.ttsStatusText.textContent = "运行中";
      toast("语音服务已启动");
    } else {
      el.ttsStatusText.textContent = result?.error || "启动失败";
      toast(result?.error || "启动失败", "error", 5000);
    }
  } catch (error) {
    toast(String(error?.message || error), "error", 4000);
  } finally {
    el.btnTtsStart.disabled = false;
    refreshVoiceStatus();
  }
}

async function previewVoice() {
  if (!el.voiceStatus) return;
  el.voiceStatus.className = "test-status";
  el.voiceStatus.textContent = "正在合成…";
  stopSpeech();
  try {
    const result = await ERI.speak({
      text: PREVIEW_LINE,
      voiceId: el.voiceId.value || state.settings?.voiceId,
      rate: Number(el.voiceRate.value || 0),
      preview: true,
    });
    if (!result?.ok) {
      el.voiceStatus.className = "test-status bad";
      el.voiceStatus.textContent = result?.error || "语音合成失败";
      return;
    }
    el.voiceStatus.className = "test-status ok";
    el.voiceStatus.textContent = "听得到吗？";
    state.voice.playing = true;
    try {
      await playAudio(result.audio);
    } finally {
      state.voice.playing = false;
    }
  } catch (error) {
    el.voiceStatus.className = "test-status bad";
    el.voiceStatus.textContent = String(error?.message || error);
  }
}

function renderVoiceOptions() {
  if (!el.voiceId) return;
  const voices = state.voices?.length
    ? state.voices
    : [
        {
          id: state.settings?.voiceId || DEFAULT_SETTINGS.voiceId,
          label: "默认音色",
          hint: "",
        },
      ];
  el.voiceId.innerHTML = "";
  for (const voice of voices) {
    const option = document.createElement("option");
    option.value = voice.id;
    option.textContent = voice.label || voice.id;
    el.voiceId.appendChild(option);
  }
  el.voiceId.value = state.settings?.voiceId || voices[0].id;
  updateVoiceHint();
}

function updateVoiceHint() {
  if (!el.voiceHint) return;
  const voice = (state.voices || []).find((item) => item.id === el.voiceId.value);
  el.voiceHint.textContent = voice?.hint || "";
}

/* ------------------------------------------------------------------ */
/* Settings                                                           */
/* ------------------------------------------------------------------ */

function sourceLabel(api) {
  switch (api?.source) {
    case "local":
      return "使用本应用保存的密钥";
    case "dsh":
      return "使用本机 DSH 配置";
    case "env":
      return "使用环境变量 BAOMIAO_API_KEY";
    default:
      return "还没有配置密钥";
  }
}

function renderSourceCard() {
  const api = state.api || { configured: false, source: "none", keyMasked: "" };
  el.apiSource.textContent = sourceLabel(api);
  el.apiMasked.textContent = api.keyMasked || "未检测到可用密钥";
  el.sourceDot.classList.toggle("bad", !api.configured);
  el.sourceDot.classList.toggle("warn", api.configured && api.source === "none");
  el.btnUseDsh.hidden = api.source !== "local";

  let placeholder = "填写 API Key";
  if (api.source === "local") placeholder = `已保存 ${api.keyMasked}，留空则不修改`;
  else if (api.source === "dsh") placeholder = `正在使用本机 DSH 配置 ${api.keyMasked}`;
  else if (api.source === "env") placeholder = `正在使用环境变量 ${api.keyMasked}`;
  el.apiKey.placeholder = placeholder;
}

function renderModelList() {
  const set = new Set(
    [...FALLBACK_MODELS, ...(state.apiModels || []), state.settings?.model].filter(Boolean),
  );
  el.modelList.innerHTML = [...set]
    .map((model) => `<option value="${escapeHtml(model)}"></option>`)
    .join("");
}

function syncPresetSelection() {
  const current = el.personaPrompt.value.trim();
  const matched = PERSONAS.find((persona) => persona.prompt.trim() === current);
  const selectedId = matched ? matched.id : "custom";
  for (const button of el.presetGrid.querySelectorAll(".preset")) {
    button.classList.toggle("selected", button.dataset.id === selectedId);
  }
  state.pendingPersonaId = selectedId;
  state.pendingPersonaName = matched ? matched.name : "自定义性格";
  el.personaCount.textContent = `${el.personaPrompt.value.length} / 20000`;
}

function renderPresetGrid() {
  el.presetGrid.innerHTML = "";
  for (const persona of PERSONAS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "preset";
    button.dataset.id = persona.id;
    const title = document.createElement("strong");
    title.textContent = persona.name;
    const tagline = document.createElement("span");
    tagline.textContent = persona.tagline;
    button.append(title, tagline);
    button.addEventListener("click", () => {
      el.personaPrompt.value = persona.prompt;
      syncPresetSelection();
      markDirty();
      el.personaPrompt.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
    el.presetGrid.appendChild(button);
  }
  el.presetGrid.classList.toggle("single", PERSONAS.length === 1);
  syncPresetSelection();
}

function fillSettingsForm() {
  const settings = state.settings || DEFAULT_SETTINGS;
  el.personaPrompt.value = settings.personaPrompt || PERSONAS[0]?.prompt || "";
  el.userName.value = settings.userName || "";
  el.baseUrl.value = settings.baseUrl || "";
  el.modelInput.value = settings.model || "";
  el.temperature.value = String(settings.temperature ?? 0.9);
  el.tempValue.textContent = Number(settings.temperature ?? 0.9).toFixed(2);
  el.maxTokens.value = String(settings.maxTokens ?? 420);
  el.contextMessages.value = String(settings.contextMessages ?? 40);
  el.stream.checked = settings.stream !== false;
  el.pinned.checked = Boolean(settings.pinned);
  el.notifications.checked = settings.notifications !== false;
  if (el.voiceEnabled) el.voiceEnabled.checked = settings.voiceEnabled !== false;
  if (el.voiceRate) el.voiceRate.value = String(settings.voiceRate ?? 0);
  if (el.voiceRateValue) {
    const rate = Number(settings.voiceRate ?? 0);
    el.voiceRateValue.textContent = `${rate >= 0 ? "+" : ""}${rate}%`;
  }
  if (el.voiceStatus) {
    el.voiceStatus.className = "test-status";
    el.voiceStatus.textContent = "";
  }
  renderVoiceOptions();
  if (el.localRoot) el.localRoot.value = settings.localRoot || "";
  if (el.localPrompt) el.localPrompt.value = settings.localPromptText || "";
  refreshVoiceStatus();
  el.apiKey.value = "";
  el.apiKey.type = "password";
  const eyeUse = el.btnEye.querySelector("use");
  if (eyeUse) eyeUse.setAttribute("href", "#i-eye");
  el.testStatus.textContent = "";
  el.testStatus.className = "test-status";
  el.saveHint.textContent = "更改会在保存后生效";
  state.settingsDirty = false;
  renderSourceCard();
  renderPresetGrid();
  renderModelList();
  updatePersonaCount();
}

function updatePersonaCount() {
  el.personaCount.textContent = `${el.personaPrompt.value.length} / 20000`;
}

function markDirty() {
  state.settingsDirty = true;
  el.saveHint.textContent = "有未保存的修改";
}

function switchTab(tab) {
  state.activeTab = tab;
  for (const button of el.tabs) button.classList.toggle("active", button.dataset.tab === tab);
  for (const pane of el.panes) pane.classList.toggle("active", pane.dataset.pane === tab);
}

function openSettings(tab = "persona") {
  if (!el.settingsLayer.hidden) {
    switchTab(tab);
    return;
  }
  fillSettingsForm();
  switchTab(tab);
  el.settingsLayer.hidden = false;
  if (tab === "connection") window.setTimeout(() => el.baseUrl.focus(), 160);
}

function closeSettings(force = false) {
  if (el.settingsLayer.hidden) return;
  if (!force && state.settingsDirty) {
    const discard = window.confirm("还有未保存的修改，要放弃吗？");
    if (!discard) return;
  }
  el.settingsLayer.hidden = true;
  state.settingsDirty = false;
  el.testStatus.textContent = "";
  el.testStatus.className = "test-status";
  el.input.focus();
}

async function saveSettingsForm() {
  const prompt = el.personaPrompt.value.trim();
  if (!prompt) {
    toast("性格提示词不能为空。", "error");
    switchTab("persona");
    el.personaPrompt.focus();
    return;
  }
  const baseUrl = el.baseUrl.value.trim();
  if (!/^https?:\/\//i.test(baseUrl)) {
    toast("API 地址需要以 http:// 或 https:// 开头。", "error");
    switchTab("connection");
    el.baseUrl.focus();
    return;
  }
  const model = el.modelInput.value.trim();
  if (!model) {
    toast("请选择一个模型。", "error");
    switchTab("connection");
    el.modelInput.focus();
    return;
  }

  const matched = PERSONAS.find((persona) => persona.prompt.trim() === prompt);
  const patch = {
    personaPrompt: prompt,
    personaId: matched ? matched.id : "custom",
    personaName: matched ? matched.name : "自定义性格",
    userName: el.userName.value.trim(),
    baseUrl,
    model,
    temperature: Number(el.temperature.value),
    maxTokens: Number(el.maxTokens.value),
    contextMessages: Number(el.contextMessages.value),
    stream: el.stream.checked,
    pinned: el.pinned.checked,
    notifications: el.notifications.checked,
    voiceEnabled: el.voiceEnabled.checked,
    voiceId: el.voiceId.value,
    voiceRate: Number(el.voiceRate.value),
    localRoot: el.localRoot?.value.trim() || "",
    localPromptText: el.localPrompt?.value ?? "",
  };
  const key = el.apiKey.value.trim();
  if (key) patch.apiKey = key;

  const previous = state.settings || DEFAULT_SETTINGS;
  const personaChanged =
    previous.personaPrompt !== prompt || previous.personaName !== patch.personaName;
  el.btnSave.disabled = true;

  try {
    const result = await ERI.saveSettings(patch);
    if (!result?.ok) {
      toast(result?.error || "保存失败。", "error", 3600);
      if (/API|Key|模型|地址|密钥/i.test(result?.error || "")) switchTab("connection");
      return;
    }
    state.settings = result.settings;
    state.api = result.api;
    state.settingsDirty = false;
    el.apiKey.value = "";
    renderChrome();
    renderModelList();
    closeSettings(true);
    if (personaChanged) {
      state.messages.push({
        id: uid(),
        role: "note",
        content: `性格已切换为「${result.settings.personaName}」`,
        ts: Date.now(),
      });
      persistHistory();
      renderMessages({ forceScroll: true });
    }
    toast("设置已保存");
  } catch (error) {
    toast(String(error?.message || error), "error", 3600);
  } finally {
    el.btnSave.disabled = false;
  }
}

async function useDshConfig() {
  if (state.api?.source === "local") {
    const ok = window.confirm("清除本应用保存的密钥，改用本机 DSH 配置？");
    if (!ok) return;
  }
  const result = await ERI.saveSettings({ clearApiKey: true });
  if (!result?.ok) {
    toast(result?.error || "切换失败。", "error");
    return;
  }
  state.settings = result.settings;
  state.api = result.api;
  el.apiKey.value = "";
  renderSourceCard();
  toast(result.api?.configured ? "已改用本机配置" : "本机也没有找到可用密钥", result.api?.configured ? "info" : "error");
}

async function testConnection() {
  el.testStatus.className = "test-status";
  el.testStatus.textContent = "正在连接…";
  el.btnTest.disabled = true;
  try {
    const result = await ERI.testConnection({
      baseUrl: el.baseUrl.value.trim(),
      apiKey: el.apiKey.value.trim(),
    });
    if (result?.ok) {
      el.testStatus.className = "test-status ok";
      el.testStatus.textContent = result.message || "连接成功。";
    } else {
      el.testStatus.className = "test-status err";
      el.testStatus.textContent = result?.error || "连接失败。";
    }
  } catch (error) {
    el.testStatus.className = "test-status err";
    el.testStatus.textContent = String(error?.message || error);
  } finally {
    el.btnTest.disabled = false;
  }
}

async function refreshModels() {
  el.btnRefresh.classList.add("spinning");
  el.btnRefresh.disabled = true;
  el.testStatus.className = "test-status";
  el.testStatus.textContent = "正在获取模型列表…";
  try {
    const result = await ERI.listModels({
      baseUrl: el.baseUrl.value.trim(),
      apiKey: el.apiKey.value.trim(),
    });
    if (result?.ok) {
      state.apiModels = result.models || [];
      renderModelList();
      el.testStatus.className = "test-status ok";
      el.testStatus.textContent = `找到 ${result.count ?? state.apiModels.length} 个可用模型。`;
    } else {
      el.testStatus.className = "test-status err";
      el.testStatus.textContent = result?.error || "获取失败。";
    }
  } catch (error) {
    el.testStatus.className = "test-status err";
    el.testStatus.textContent = String(error?.message || error);
  } finally {
    el.btnRefresh.classList.remove("spinning");
    el.btnRefresh.disabled = false;
  }
}

/* ------------------------------------------------------------------ */
/* Export / clear / quit                                              */
/* ------------------------------------------------------------------ */

function buildExportMarkdown() {
  const lines = ["# 与绘梨衣的对话", "", `导出时间：${new Date().toLocaleString("zh-CN")}`, ""];
  let lastDate = "";
  for (const message of state.messages) {
    const key = dayKey(message.ts);
    if (key && key !== lastDate) {
      lines.push(`## ${formatDate(message.ts)}`, "");
      lastDate = key;
    }
    if (message.role === "note") {
      lines.push(`> *${message.content}*`, "");
      continue;
    }
    const who = message.role === "user" ? "你" : "绘梨衣";
    lines.push(`**${who}** · ${formatTime(message.ts)}`, "", message.content, "");
    if (message.error) lines.push(`> ⚠️ ${message.error}`, "");
  }
  return lines.join("\n");
}

async function exportHistory() {
  if (!state.messages.length) {
    toast("还没有可以导出的对话。", "error");
    return;
  }
  const now = new Date();
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(
    now.getDate(),
  ).padStart(2, "0")}-${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(
    2,
    "0",
  )}`;
  try {
    const result = await ERI.exportText({
      content: buildExportMarkdown(),
      defaultName: `绘梨衣对话-${stamp}.md`,
    });
    if (result?.ok) toast("聊天记录已导出");
    else if (!result?.canceled) toast(result?.error || "导出失败。", "error");
  } catch (error) {
    toast(String(error?.message || error), "error");
  }
}

function clearHistory() {
  if (state.streaming) stopStreaming();
  const ok = window.confirm("要清空和绘梨衣的全部聊天记录吗？此操作不能撤销。");
  if (!ok) return;
  state.messages = [];
  state.assistantId = null;
  state.requestId = null;
  persistHistoryNow();
  renderMessages({ forceScroll: true });
  setStatus("在桌面陪着你");
  toast("聊天记录已清空");
}

/* ------------------------------------------------------------------ */
/* Boot                                                               */
/* ------------------------------------------------------------------ */

async function boot() {
  if (!ERI) {
    document.body.innerHTML =
      '<div style="padding:24px;color:#fff;font-family:sans-serif">预加载脚本没有加载成功。</div>';
    return;
  }

  try {
    const bootState = await ERI.getState();
    state.settings = { ...DEFAULT_SETTINGS, ...(bootState.settings || {}) };
    state.api = bootState.api || { configured: false, source: "none", keyMasked: "" };
    state.version = bootState.version || "";
    el.aboutVersion.textContent = `v${state.version || "1.0.0"}`;
  } catch (error) {
    state.settings = { ...DEFAULT_SETTINGS };
    state.api = { configured: false, source: "none", keyMasked: "" };
    toast("没有读取到本地设置，先使用默认配置。", "error", 3000);
  }

  if (!state.settings.personaPrompt.trim()) {
    const first = PERSONAS[0];
    if (first) {
      state.settings.personaPrompt = first.prompt;
      state.settings.personaId = first.id;
      state.settings.personaName = first.name;
      ERI.saveSettings({
        personaPrompt: first.prompt,
        personaId: first.id,
        personaName: first.name,
      })
        .then((result) => {
          if (result?.ok) {
            state.settings = result.settings;
            state.api = result.api;
            renderChrome();
          }
        })
        .catch(() => {});
    }
  }

  if (state.demo === "chat" || state.demo.startsWith("settings")) seedDemo();
  else loadHistory();

  const draft = loadDraft();
  if (draft) {
    el.input.value = draft;
    autoResizeInput();
  }

  renderChrome();
  renderModelList();
  renderMessages({ forceScroll: true });
  autoResizeInput();
  updateSendButton();
  bindEvents();
  state.booted = true;

  if (state.demo.startsWith("settings")) {
    const demoTab = state.demo === "settings" ? "persona" : state.demo.split("-")[1] || "persona";
    window.setTimeout(() => openSettings(demoTab), 120);
  }

  if (!state.demo && !state.api.configured) {
    window.setTimeout(() => {
      if (!state.api.configured) {
        toast("还没有配置 API Key，点右上角设置 → 连接。", "error", 4200);
      }
    }, 900);
  }

  window.__eriDebug = {
    send: (text) => sendMessage(text),
    status: () => {
      const lastAssistant = [...state.messages]
        .reverse()
        .find((message) => message.role === "assistant");
      return {
        streaming: state.streaming,
        messageCount: state.messages.length,
        lastAssistant: lastAssistant?.content || "",
        error: lastAssistant?.error || "",
        requestId: state.requestId,
      };
    },
    openSettings,
    clear: clearHistory,
    speak: (text) => speakText(text, { preview: true }),
    stopSpeech,
    voiceState: () => ({
      enabled: voiceOn(),
      playing: state.voice.playing,
      queued: state.voice.queue.length,
      buffer: state.voice.buffer,
    }),
  };
}

function seedDemo() {
  const now = Date.now();
  state.messages = [
    {
      id: "demo-1",
      role: "assistant",
      content: "晚上好。（她从桌面上抬起头，红色的眼睛亮了一下）\n\n今天过得怎么样？",
      ts: now - 1000 * 60 * 8,
    },
    {
      id: "demo-2",
      role: "user",
      content: "有点累，写了一天的代码。",
      ts: now - 1000 * 60 * 7,
    },
    {
      id: "demo-3",
      role: "assistant",
      content:
        "那就先不要写了。（她挪近了一点，轻轻拽了拽你的袖口）\n\n要不要喝点水？我陪你坐一会儿。",
      ts: now - 1000 * 60 * 6,
    },
  ];
}

/* ------------------------------------------------------------------ */
/* Events                                                             */
/* ------------------------------------------------------------------ */

function bindEvents() {
  el.input.addEventListener("input", () => {
    autoResizeInput();
    updateSendButton();
    saveDraftSoon();
  });

  el.input.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    if (event.shiftKey) return;
    if (event.isComposing || state.composing) return;
    event.preventDefault();
    if (state.streaming) return;
    sendMessage(el.input.value);
  });

  el.input.addEventListener("compositionstart", () => {
    state.composing = true;
  });
  el.input.addEventListener("compositionend", () => {
    state.composing = false;
  });

  el.sendBtn.addEventListener("click", () => {
    if (state.streaming) stopStreaming();
    else sendMessage(el.input.value);
  });

  if (el.btnCall) el.btnCall.addEventListener("click", () => ERI.openCall());

  el.btnPin.addEventListener("click", async () => {
    const next = !state.settings?.pinned;
    const result = await ERI.setPinned(next);
    if (result?.ok) {
      state.settings.pinned = result.pinned;
      updatePinUI();
      toast(result.pinned ? "窗口已置顶" : "已取消置顶", "info", 1500);
    }
  });

  el.btnSettings.addEventListener("click", () => openSettings("persona"));
  el.chipPersona.addEventListener("click", () => openSettings("persona"));
  el.chipModel.addEventListener("click", () => openSettings("connection"));
  el.btnMin.addEventListener("click", () => ERI.minimize());
  el.btnClose.addEventListener("click", () => ERI.hide());

  el.newMsgPill.addEventListener("click", () => {
    scrollToBottom("smooth");
    el.newMsgPill.classList.remove("show");
  });

  el.scroll.addEventListener("scroll", () => {
    if (isNearBottom()) el.newMsgPill.classList.remove("show");
  });

  el.messages.addEventListener("click", (event) => {
    const link = event.target.closest("a[href]");
    if (link) {
      event.preventDefault();
      ERI.openLink(link.href);
      return;
    }
    const button = event.target.closest("[data-action]");
    if (!button) return;
    const article = button.closest(".msg");
    const id = article?.dataset.id || "";
    const action = button.dataset.action;
    if (action === "copy") copyMessage(id);
    if (action === "retry") retryAssistant(id);
    if (action === "regen") regenerate(id);
    if (action === "settings") openSettings("connection");
  });

  document.querySelectorAll("[data-send]").forEach((button) => {
    button.addEventListener("click", () => sendMessage(button.dataset.send || ""));
  });

  el.settingsLayer.addEventListener("click", (event) => {
    if (event.target.closest("[data-close-settings]")) {
      closeSettings();
    }
  });

  for (const tab of el.tabs) {
    tab.addEventListener("click", () => switchTab(tab.dataset.tab || "persona"));
  }

  el.personaPrompt.addEventListener("input", () => {
    syncPresetSelection();
    markDirty();
  });

  el.userName.addEventListener("input", markDirty);
  el.baseUrl.addEventListener("input", markDirty);
  el.modelInput.addEventListener("input", markDirty);
  el.maxTokens.addEventListener("input", markDirty);
  el.contextMessages.addEventListener("input", markDirty);
  el.temperature.addEventListener("input", () => {
    el.tempValue.textContent = Number(el.temperature.value).toFixed(2);
    markDirty();
  });
  el.stream.addEventListener("change", markDirty);
  el.pinned.addEventListener("change", markDirty);
  el.notifications.addEventListener("change", markDirty);
  if (el.localRoot) el.localRoot.addEventListener("input", markDirty);
  if (el.localPrompt) el.localPrompt.addEventListener("input", markDirty);
  if (el.btnTtsStart) el.btnTtsStart.addEventListener("click", startVoiceService);
  try {
    ERI.onVoiceLog((line) => {
      if (el.ttsStatusText && line) el.ttsStatusText.textContent = line;
    });
  } catch {}
  if (el.voiceEnabled) el.voiceEnabled.addEventListener("change", markDirty);
  if (el.voiceId) {
    el.voiceId.addEventListener("change", () => {
      updateVoiceHint();
      markDirty();
    });
  }
  if (el.voiceRate) {
    el.voiceRate.addEventListener("input", () => {
      const rate = Number(el.voiceRate.value);
      el.voiceRateValue.textContent = `${rate >= 0 ? "+" : ""}${rate}%`;
      markDirty();
    });
  }
  if (el.btnVoiceTest) el.btnVoiceTest.addEventListener("click", previewVoice);
  if (el.chipVoice) {
    el.chipVoice.addEventListener("click", async () => {
      const next = !voiceOn();
      if (!next) stopSpeech();
      const result = await ERI.saveSettings({ voiceEnabled: next });
      if (!result?.ok) {
        toast(result?.error || "切换失败。", "error");
        return;
      }
      state.settings = result.settings;
      state.api = result.api;
      updateVoiceChip();
      toast(next ? "声音打开了" : "已经安静下来", "info", 1500);
    });
  }

  el.btnEye.addEventListener("click", () => {
    const showing = el.apiKey.type === "text";
    el.apiKey.type = showing ? "password" : "text";
    const use = el.btnEye.querySelector("use");
    if (use) use.setAttribute("href", showing ? "#i-eye" : "#i-eye-off");
  });

  el.btnTest.addEventListener("click", testConnection);
  el.btnRefresh.addEventListener("click", refreshModels);
  el.btnSave.addEventListener("click", saveSettingsForm);
  el.btnUseDsh.addEventListener("click", useDshConfig);

  el.btnLocate.addEventListener("click", async () => {
    const result = await ERI.locatePet();
    if (result?.pet) toast("已回到桌宠身边");
    else toast("没有找到桌宠窗口，可能它还没有启动。", "error", 3000);
  });

  el.btnExport.addEventListener("click", exportHistory);
  el.btnClear.addEventListener("click", clearHistory);
  el.btnQuit.addEventListener("click", () => {
    const ok = window.confirm("要退出绘梨衣对话吗？托盘图标也会一起消失。");
    if (ok) ERI.quit();
  });

  document.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === ",") {
      event.preventDefault();
      if (el.settingsLayer.hidden) openSettings("persona");
      else closeSettings();
      return;
    }
    if (event.key === "Escape") {
      if (!el.settingsLayer.hidden) {
        event.preventDefault();
        closeSettings();
      } else if (state.streaming) {
        event.preventDefault();
        stopStreaming();
      }
    }
  });

  window.addEventListener("beforeunload", () => {
    persistHistoryNow();
    saveDraftNow();
  });

  ERI.onDelta(handleDelta);
  ERI.onDone(handleDone);
  ERI.onError(handleError);
  ERI.onOpenSettings((tab) => openSettings(tab || "persona"));
}

boot().catch((error) => {
  console.error(error);
  toast(String(error?.message || error), "error", 5000);
});

/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* 头像菜单                                                            */
/* ------------------------------------------------------------------ */

function setupAvatarMenu() {
  const avatar = document.getElementById("identity-avatar");
  const menu = document.getElementById("avatar-menu");
  const voiceBtn = document.getElementById("avatar-menu-voice");
  if (!avatar || !menu) return;

  const close = () => { menu.hidden = true; };
  const refreshVoiceLabel = () => {
    if (voiceBtn) voiceBtn.textContent = voiceOn() ? "静音" : "声音开";
  };

  avatar.addEventListener("click", (event) => {
    event.stopPropagation();
    if (menu.hidden) {
      menu.hidden = false;
      refreshVoiceLabel();
    } else {
      close();
    }
  });

  document.addEventListener("click", (event) => {
    if (menu.hidden) return;
    if (menu.contains(event.target) || avatar.contains(event.target)) return;
    close();
  });

  menu.querySelectorAll("[data-action]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const action = btn.dataset.action;
      close();
      if (action === "call") {
        try { ERI.openCall(); } catch {}
        return;
      }
      if (action === "persona") { openSettings("persona"); return; }
      if (action === "settings") { openSettings("connection"); return; }
      if (action === "voice") {
        const next = !voiceOn();
        if (!next) stopSpeech();
        const result = await ERI.saveSettings({ voiceEnabled: next });
        if (!result?.ok) { toast(result?.error || "切换失败。", "error"); return; }
        state.settings = result.settings;
        updateVoiceChip();
        return;
      }
      if (action === "memory") openMemory("nebula");
    });
  });
}

/* ------------------------------------------------------------------ */
/* 识海：星云图 + 列表                                                 */
/* ------------------------------------------------------------------ */

let memoryData = null;
let memoryTab = "nebula";
let memoryQuery = "";
let nebulaFrame = 0;
let nebulaCleanup = null;

function memoryLines(text) {
  return String(text || "")
    .split("\n")
    .map((line) => line.replace(/^[-#*\s]+/, "").trim())
    .filter(Boolean);
}

function buildNebulaNodes(data) {
  const nodes = [];
  (data.facts || []).forEach((f) => {
    nodes.push({ type: "fact", label: f.content, meta: f.created, color: "#ff8f9b", r: 5 });
  });
  (data.loops || []).forEach((l) => {
    nodes.push({ type: "loop", label: l.content, meta: l.due, color: "#ffc46b", r: 5.5 });
  });
  memoryLines(data.timeline).forEach((line) => {
    nodes.push({ type: "timeline", label: line, meta: "", color: "#8fd0ff", r: 4 });
  });
  return nodes;
}

function bigrams(text) {
  const clean = String(text || "").replace(/[^\u4e00-\u9fffA-Za-z0-9]/g, "");
  const set = new Set();
  for (let i = 0; i < clean.length - 1; i += 1) set.add(clean.slice(i, i + 2));
  return set;
}

function buildNebulaLinks(nodes) {
  const links = [];
  const sets = nodes.map((n) => bigrams(n.label));
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      let shared = 0;
      sets[i].forEach((g) => { if (sets[j].has(g)) shared += 1; });
      if (shared > 0) links.push({ a: i, b: j, w: Math.min(1, shared / 4) });
    }
  }
  return links;
}

function renderNebula(body) {
  const nodes = buildNebulaNodes(memoryData || {});
  if (!nodes.length) {
    body.innerHTML =
      '<div class="nebula-empty">' +
      '<div class="nebula-empty-star"></div>' +
      '<div class="nebula-empty-text">还没有记忆星<br /><span>聊天时说「我叫…」「我喜欢…」<br />她会记下来，这里会慢慢亮起来</span></div>' +
      "</div>";
    return;
  }

  body.innerHTML =
    '<div class="nebula-wrap">' +
    '<canvas class="nebula-canvas" id="nebula-canvas"></canvas>' +
    '<div class="nebula-legend">' +
    '<span><i style="background:#ff8f9b"></i>事实</span>' +
    '<span><i style="background:#7fc4ff"></i>时间线</span>' +
    '<span><i style="background:#ffbe6b"></i>未完成</span>' +
    "</div>" +
    '<div class="nebula-tip" id="nebula-tip" hidden></div>' +
    '<div class="nebula-detail" id="nebula-detail" hidden></div>' +
    "</div>";

  const wrap = body.querySelector(".nebula-wrap");
  const canvas = body.querySelector("#nebula-canvas");
  const tip = body.querySelector("#nebula-tip");
  const detail = body.querySelector("#nebula-detail");
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  let w = 0;
  let h = 0;

  const resize = () => {
    w = wrap.clientWidth;
    h = wrap.clientHeight;
    canvas.width = Math.max(1, Math.floor(w * dpr));
    canvas.height = Math.max(1, Math.floor(h * dpr));
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
  };
  resize();

  const links = buildNebulaLinks(nodes);
  const golden = Math.PI * (3 - Math.sqrt(5));

  const layout = () => {
    const cx = w / 2;
    const cy = h / 2;
    const maxR = Math.min(w, h) * 0.42;
    nodes.forEach((n, i) => {
      const t = (i + 0.5) / nodes.length;
      const r = Math.sqrt(t) * maxR;
      const a = i * golden;
      n.x = cx + Math.cos(a) * r * (w > h ? 1.12 : 1);
      n.y = cy + Math.sin(a) * r;
      n.x = Math.max(30, Math.min(w - 30, n.x));
      n.y = Math.max(30, Math.min(h - 30, n.y));
      n.phase = Math.random() * Math.PI * 2;
    });
  };
  layout();

  // 背景：星尘 + 星云气体
  let bgStars = [];
  const buildStars = () => {
    bgStars = Array.from({ length: 110 }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      r: Math.random() * 1.1 + 0.25,
      a: Math.random() * 0.5 + 0.15,
      p: Math.random() * Math.PI * 2,
      s: Math.random() * 0.8 + 0.3,
    }));
  };
  buildStars();

  const clouds = [
    { x: 0.32, y: 0.34, r: 0.46, c: "120, 30, 58", a: 0.20 },
    { x: 0.70, y: 0.62, r: 0.42, c: "44, 44, 116", a: 0.16 },
    { x: 0.48, y: 0.82, r: 0.40, c: "148, 62, 44", a: 0.12 },
  ];

  let zoom = 1;
  let panX = 0;
  let panY = 0;
  let hover = -1;
  let selected = -1;
  let dragging = false;
  let dragStart = null;
  let downPos = null;
  let moved = false;
  let pointer = { x: 0.5, y: 0.5 };

  const toWorld = (sx, sy) => ({
    x: (sx - w / 2 - panX) / zoom + w / 2,
    y: (sy - h / 2 - panY) / zoom + h / 2,
  });

  const hitTest = (sx, sy) => {
    const p = toWorld(sx, sy);
    let best = -1;
    let bestD = 16 / zoom;
    nodes.forEach((n, i) => {
      const d = Math.hypot(n.x - p.x, n.y - p.y);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return best;
  };

  const drawBackground = (t) => {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const base = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.75);
    base.addColorStop(0, "#160a11");
    base.addColorStop(1, "#07040a");
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);

    for (const c of clouds) {
      const px = (c.x - 0.5) * w * 0.04 * (pointer.x - 0.5) * 2;
      const py = (c.y - 0.5) * h * 0.04 * (pointer.y - 0.5) * 2;
      const cx = c.x * w + px;
      const cy = c.y * h + py;
      const rad = c.r * Math.min(w, h);
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
      g.addColorStop(0, `rgba(${c.c}, ${c.a})`);
      g.addColorStop(1, `rgba(${c.c}, 0)`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }

    for (const s of bgStars) {
      const tw = 0.55 + Math.sin(t * s.s + s.p) * 0.45;
      ctx.fillStyle = `rgba(255, 232, 238, ${(s.a * tw).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
  };

  const drawLinks = (t) => {
    for (const l of links) {
      const a = nodes[l.a];
      const b = nodes[l.b];
      const g = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
      g.addColorStop(0, a.color + "00");
      g.addColorStop(0.5, a.color + "55");
      g.addColorStop(1, b.color + "00");
      ctx.strokeStyle = g;
      ctx.lineWidth = 0.6 + l.w * 0.9;
      ctx.globalAlpha = 0.18 + l.w * 0.3;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // 沿连线流动的光点
    for (const l of links) {
      if (l.w < 0.45) continue;
      const a = nodes[l.a];
      const b = nodes[l.b];
      const k = ((t * 0.18 + (l.a + l.b) * 0.11) % 1);
      const px = a.x + (b.x - a.x) * k;
      const py = a.y + (b.y - a.y) * k;
      ctx.fillStyle = "rgba(255, 216, 224, 0.65)";
      ctx.beginPath();
      ctx.arc(px, py, 1.1, 0, Math.PI * 2);
      ctx.fill();
    }
  };

  const drawNode = (n, i, t) => {
    const active = i === hover || i === selected;
    const tw = 0.85 + Math.sin(t * 1.3 + (n.phase || i)) * 0.15;
    const r = n.r * tw * (active ? 1.7 : 1);
    const nx = n.x + Math.sin(t * 0.5 + i * 1.7) * 1.4;
    const ny = n.y + Math.cos(t * 0.42 + i * 2.1) * 1.4;

    const halo = ctx.createRadialGradient(nx, ny, 0, nx, ny, r * 7);
    halo.addColorStop(0, n.color + "aa");
    halo.addColorStop(0.3, n.color + "44");
    halo.addColorStop(1, n.color + "00");
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(nx, ny, r * 7, 0, Math.PI * 2);
    ctx.fill();

    // 十字星芒
    if (r >= 4 || active) {
      const len = r * (active ? 5 : 3.6);
      const grad = ctx.createLinearGradient(nx - len, ny, nx + len, ny);
      grad.addColorStop(0, n.color + "00");
      grad.addColorStop(0.5, n.color + (active ? "cc" : "77"));
      grad.addColorStop(1, n.color + "00");
      ctx.strokeStyle = grad;
      ctx.lineWidth = active ? 1.2 : 0.8;
      ctx.beginPath();
      ctx.moveTo(nx - len, ny);
      ctx.lineTo(nx + len, ny);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(nx, ny - len);
      ctx.lineTo(nx, ny + len);
      ctx.stroke();
    }

    ctx.fillStyle = active ? "#fff7f9" : n.color;
    ctx.beginPath();
    ctx.arc(nx, ny, r, 0, Math.PI * 2);
    ctx.fill();

    if (active) {
      ctx.strokeStyle = "rgba(255, 226, 232, 0.85)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(nx, ny, r + 6, 0, Math.PI * 2);
      ctx.stroke();
    }

    if (i === selected) {
      const text = n.label.length > 12 ? n.label.slice(0, 12) + "…" : n.label;
      ctx.font = "11px 'Microsoft YaHei UI', sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      const tw2 = ctx.measureText(text).width;
      ctx.fillStyle = "rgba(18, 9, 14, 0.86)";
      ctx.beginPath();
      ctx.roundRect(nx - tw2 / 2 - 6, ny - 26, tw2 + 12, 17, 6);
      ctx.fill();
      ctx.fillStyle = "#f7e6ea";
      ctx.fillText(text, nx, ny - 12);
    }
  };

  const draw = () => {
    const t = Date.now() / 1000;
    drawBackground(t);

    ctx.save();
    ctx.translate(w / 2 + panX, h / 2 + panY);
    ctx.scale(zoom, zoom);
    ctx.translate(-w / 2, -h / 2);

    drawLinks(t);
    nodes.forEach((n, i) => drawNode(n, i, t));
    ctx.restore();

    // 边缘压暗
    const vig = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.72);
    vig.addColorStop(0, "rgba(0,0,0,0)");
    vig.addColorStop(1, "rgba(5, 2, 6, 0.55)");
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, w, h);
  };

  const loop = () => {
    draw();
    nebulaFrame = requestAnimationFrame(loop);
  };

  const showTip = (i, sx, sy) => {
    if (i < 0) {
      tip.hidden = true;
      return;
    }
    const n = nodes[i];
    tip.textContent = n.label.length > 40 ? n.label.slice(0, 40) + "…" : n.label;
    tip.hidden = false;
    tip.style.left = Math.min(Math.max(8, sx + 12), w - 190) + "px";
    tip.style.top = Math.max(8, sy - 28) + "px";
  };

  const showDetail = (i) => {
    if (i < 0) {
      detail.hidden = true;
      return;
    }
    const n = nodes[i];
    detail.hidden = false;
    detail.innerHTML =
      `<div class="nebula-detail-text">${escapeHtml(n.label)}</div>` +
      `<div class="nebula-detail-meta">${escapeHtml(n.meta || "")}${n.type === "loop" ? " · 未完成" : ""}</div>` +
      `<button class="nebula-detail-btn" id="nebula-remove" type="button">${n.type === "loop" ? "标记完成" : "删除这条记忆"}</button>`;
    detail.querySelector("#nebula-remove").addEventListener("click", async () => {
      const result = await ERI.deleteMemory({
        type: n.type === "loop" ? "loop" : "fact",
        content: n.label,
      });
      if (!result?.ok) {
        toast("删除失败。", "error");
        return;
      }
      memoryData = await ERI.listMemory();
      renderMemory();
    });
  };

  canvas.addEventListener("mousemove", (event) => {
    const rect = canvas.getBoundingClientRect();
    const sx = event.clientX - rect.left;
    const sy = event.clientY - rect.top;
    pointer = { x: sx / Math.max(1, w), y: sy / Math.max(1, h) };
    if (dragging && dragStart) {
      panX += sx - dragStart.sx;
      panY += sy - dragStart.sy;
      dragStart = { sx, sy };
      return;
    }
    hover = hitTest(sx, sy);
    canvas.style.cursor = hover >= 0 ? "pointer" : "grab";
    showTip(hover, sx, sy);
  });

  canvas.addEventListener("mousedown", (event) => {
    const rect = canvas.getBoundingClientRect();
    downPos = { sx: event.clientX - rect.left, sy: event.clientY - rect.top };
    dragStart = { ...downPos };
    dragging = false;
    moved = false;
    canvas.style.cursor = "grabbing";
  });

  window.addEventListener("mousemove", (event) => {
    if (!downPos) return;
    const rect = canvas.getBoundingClientRect();
    const sx = event.clientX - rect.left;
    const sy = event.clientY - rect.top;
    if (Math.hypot(sx - downPos.sx, sy - downPos.sy) > 3) {
      moved = true;
      dragging = true;
      panX += sx - dragStart.sx;
      panY += sy - dragStart.sy;
      dragStart = { sx, sy };
    }
  });

  window.addEventListener("mouseup", (event) => {
    if (!downPos) return;
    const rect = canvas.getBoundingClientRect();
    const sx = event.clientX - rect.left;
    const sy = event.clientY - rect.top;
    if (!moved) {
      selected = hitTest(sx, sy);
      showDetail(selected);
    }
    downPos = null;
    dragStart = null;
    dragging = false;
    canvas.style.cursor = hover >= 0 ? "pointer" : "grab";
  });

  canvas.addEventListener("mouseleave", () => {
    tip.hidden = true;
    hover = -1;
  });

  canvas.addEventListener("wheel", (event) => {
    event.preventDefault();
    zoom = Math.max(0.5, Math.min(2.4, zoom * (event.deltaY > 0 ? 0.92 : 1.08)));
  }, { passive: false });

  loop();
  nebulaCleanup = () => cancelAnimationFrame(nebulaFrame);
}

function renderMemory() {
  const body = document.getElementById("memory-body");
  const foot = document.getElementById("memory-foot");
  const search = document.getElementById("memory-search");
  if (!body) return;
  if (nebulaCleanup) { nebulaCleanup(); nebulaCleanup = null; }

  const data = memoryData || {};
  const q = memoryQuery.trim();
  if (search) {
    search.style.display = memoryTab === "nebula" || memoryTab === "loops" || memoryTab === "self" || memoryTab === "canon" ? "none" : "";
  }

  if (memoryTab === "nebula") {
    renderNebula(body);
    if (foot) {
      const count = buildNebulaNodes(data).length;
      foot.textContent = `${count} 颗记忆星 · 拖动平移 · 滚轮缩放 · 点一下看内容`;
    }
    return;
  }

  const card = (content, meta) =>
    `<div class="mem-card"><div class="mem-text">${escapeHtml(content)}</div>` +
    (meta ? `<div class="mem-meta">${meta}</div>` : "") +
    `</div>`;

  let html = "";
  let count = 0;

  if (memoryTab === "facts") {
    const items = (data.facts || []).filter((f) => !q || String(f.content).includes(q));
    count = items.length;
    html = items
      .map((f) =>
        `<div class="mem-card"><div class="mem-text">${escapeHtml(f.content)}</div>` +
        `<div class="mem-meta">${escapeHtml((f.created || "").slice(0, 10))}${f.source ? " · " + escapeHtml(f.source) : ""}` +
        `<button class="mem-del" type="button" data-del="fact" data-content="${escapeHtml(f.content)}">删除</button></div></div>`,
      )
      .join("");
    if (!html) html = '<div class="mem-empty">还没记住什么。聊天时说「我叫…」「我喜欢…」她会记下来。</div>';
  } else if (memoryTab === "loops") {
    const items = data.loops || [];
    count = items.length;
    html = items
      .map((l) =>
        `<div class="mem-card"><div class="mem-text">${escapeHtml(l.content)}</div>` +
        `<div class="mem-meta">${l.due ? "截止 " + escapeHtml(l.due) : "没设期限"}` +
        `<button class="mem-del" type="button" data-del="loop" data-content="${escapeHtml(l.content)}">完成</button></div></div>`,
      )
      .join("");
    if (!html) html = '<div class="mem-empty">没有答应过还没做完的事。</div>';
  } else if (memoryTab === "timeline") {
    const items = memoryLines(data.timeline).filter((x) => !q || x.includes(q));
    count = items.length;
    html = items.map((line) => card(line, "")).join("") || '<div class="mem-empty">时间线还是空的。</div>';
  } else {
    const source = memoryTab === "self" ? data.self : data.canon;
    const items = memoryLines(source);
    count = items.length;
    html = items.map((line) => card(line, "")).join("") || '<div class="mem-empty">还没有内容。</div>';
  }

  body.innerHTML = html;
  if (foot) foot.textContent = `共 ${count} 条 · 只存在本机`;

  body.querySelectorAll("[data-del]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const type = btn.dataset.del;
      const content = btn.dataset.content;
      const result = await ERI.deleteMemory({ type, content });
      if (!result?.ok) { toast("删除失败。", "error"); return; }
      memoryData = await ERI.listMemory();
      renderMemory();
    });
  });
}

async function openMemory(tab = "nebula") {
  memoryTab = tab;
  memoryQuery = "";
  const modal = document.getElementById("memory-modal");
  const search = document.getElementById("memory-search");
  if (!modal) return;
  modal.hidden = false;
  if (search) search.value = "";
  document.querySelectorAll(".memory-tab").forEach((el) => {
    el.classList.toggle("active", el.dataset.tab === memoryTab);
  });
  const body = document.getElementById("memory-body");
  if (body) body.innerHTML = '<div class="mem-empty">读取中…</div>';
  memoryData = await ERI.listMemory();
  renderMemory();
}

function closeMemory() {
  const modal = document.getElementById("memory-modal");
  if (modal) modal.hidden = true;
  if (nebulaCleanup) { nebulaCleanup(); nebulaCleanup = null; }
}

function setupMemoryPanel() {
  const modal = document.getElementById("memory-modal");
  if (!modal) return;
  document.getElementById("memory-close")?.addEventListener("click", closeMemory);
  modal.addEventListener("click", (event) => {
    if (event.target === modal) closeMemory();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !modal.hidden) closeMemory();
    if (event.ctrlKey && event.shiftKey && String(event.key).toLowerCase() === "m") {
      event.preventDefault();
      openMemory("nebula");
    }
  });
  document.querySelectorAll(".memory-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      memoryTab = btn.dataset.tab;
      memoryQuery = "";
      const search = document.getElementById("memory-search");
      if (search) search.value = "";
      document.querySelectorAll(".memory-tab").forEach((el) => {
        el.classList.toggle("active", el.dataset.tab === memoryTab);
      });
      renderMemory();
    });
  });
  const search = document.getElementById("memory-search");
  if (search) {
    search.addEventListener("input", () => {
      memoryQuery = search.value || "";
      renderMemory();
    });
  }
}

setupAvatarMenu();
setupMemoryPanel();

setTimeout(() => {
  try {
    if (new URLSearchParams(location.search).get("panel") === "memory") {
      openMemory("nebula");
    }
  } catch {}
}, 900);
