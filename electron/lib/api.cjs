"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const DEFAULT_BASE_URL = "https://open-ai.baomiao.cn/v1";
const DEFAULT_MODEL = "DeepSeek-V4.1-Flash 1017(1.20x)";

/**
 * The local DSH installation stores the user's provider key here. We only ever
 * read it; the chat window never writes to the DSH directory.
 */
function readDshApiKey() {
  try {
    const file = path.join(os.homedir(), ".dsh", ".credentials.yaml");
    if (!fs.existsSync(file)) return "";
    const text = fs.readFileSync(file, "utf8");
    const match = text.match(/BAOMIAO_API_KEY:\s*["']?([^\s"'#]+)["']?/);
    return match ? match[1].trim() : "";
  } catch {
    return "";
  }
}

function maskKey(key) {
  if (!key) return "";
  if (key.length <= 10) return "••••••";
  return `${key.slice(0, 4)}••••••••${key.slice(-4)}`;
}

class ApiError extends Error {
  constructor(message, code = "api_error", status = 0, detail = "") {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

function friendlyStatus(status) {
  if (status === 401) return "API Key 无效或已过期（401）";
  if (status === 403) return "当前 Key 没有访问权限（403）";
  if (status === 404) return "接口地址或模型不存在（404）";
  if (status === 402) return "账户额度不足（402）";
  if (status === 429) return "请求太频繁或额度受限（429）";
  if (status >= 500) return `上游服务暂时不可用（${status}）`;
  return `请求失败（${status}）`;
}

function parseUpstreamError(status, text) {
  let detail = "";
  try {
    const json = JSON.parse(text);
    detail =
      json?.error?.message ||
      json?.message ||
      json?.error?.detail ||
      json?.detail ||
      "";
    if (typeof detail !== "string") detail = JSON.stringify(detail);
  } catch {
    detail = String(text || "").trim();
  }
  detail = detail.slice(0, 500);
  const base = friendlyStatus(status);
  return new ApiError(detail ? `${base}：${detail}` : base, "http_error", status, detail);
}

function normalizeBaseUrl(url) {
  return String(url || "").trim().replace(/\/+$/, "");
}

async function readErrorBody(response) {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

/**
 * Stream an OpenAI-compatible chat completion.
 *
 * Returns { content, reasoning, model }. `onDelta` is invoked for every text
 * fragment. `fetchImpl` lets Electron use its Chromium network stack (system
 * proxy aware) while Node tests can use the global fetch.
 */
async function streamChat({
  baseUrl,
  apiKey,
  model,
  messages,
  temperature = 0.9,
  maxTokens = 400,
  stream = true,
  signal,
  fetchImpl = globalThis.fetch,
  onDelta = () => {},
}) {
  if (!apiKey) throw new ApiError("还没有配置 API Key", "no_key");
  if (!baseUrl) throw new ApiError("还没有配置 API 地址", "no_base_url");
  if (!model) throw new ApiError("还没有选择模型", "no_model");
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new ApiError("没有可发送的消息", "no_messages");
  }

  const url = `${normalizeBaseUrl(baseUrl)}/chat/completions`;
  const body = {
    model,
    messages,
    temperature: Math.min(2, Math.max(0, Number(temperature) || 0)),
    max_tokens: Math.min(8192, Math.max(32, Math.round(Number(maxTokens) || 400))),
    stream: !!stream,
  };

  let response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: stream ? "text/event-stream" : "application/json",
      },
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (error?.name === "AbortError" || signal?.aborted) {
      const reason = signal?.reason;
      if (reason && reason.code === "timeout") {
        throw new ApiError("请求超时了，可能是网络不太稳定。", "timeout");
      }
      throw new ApiError("已停止回复", "aborted");
    }
    const message = String(error?.message || error || "");
    if (/certificate|ssl|tls/i.test(message)) {
      throw new ApiError("HTTPS 证书校验失败，请检查代理设置。", "network");
    }
    if (/fetch failed|network|ECONN|ENOTFOUND|ETIMEDOUT|socket/i.test(message)) {
      throw new ApiError("网络连接失败，请检查网络或代理设置。", "network");
    }
    throw new ApiError(message || "网络请求失败", "network");
  }

  if (!response.ok) {
    throw parseUpstreamError(response.status, await readErrorBody(response));
  }

  const contentType = String(response.headers.get("content-type") || "").toLowerCase();

  // Some gateways ignore stream=true and answer with a plain JSON body.
  if (!contentType.includes("text/event-stream")) {
    let json;
    try {
      json = await response.json();
    } catch {
      throw new ApiError("上游返回了无法识别的响应。", "bad_response");
    }
    const choice = json?.choices?.[0];
    const content = String(choice?.message?.content || choice?.text || "");
    if (content) onDelta(content);
    return {
      content,
      reasoning: String(choice?.message?.reasoning_content || ""),
      model: String(json?.model || model),
    };
  }

  if (!response.body) {
    throw new ApiError("上游没有返回可读取的数据流。", "bad_response");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let content = "";
  let reasoning = "";
  let done = false;
  let responseModel = model;
  let parsedLines = 0;

  const handleLine = (line) => {
    const trimmed = line.replace(/\r$/, "");
    if (!trimmed.startsWith("data:")) return;
    const data = trimmed.slice(5).trim();
    if (!data) return;
    if (data === "[DONE]") {
      done = true;
      return;
    }
    let json;
    try {
      json = JSON.parse(data);
      parsedLines += 1;
    } catch {
      return;
    }
    if (json?.model) responseModel = String(json.model);
    const delta = json?.choices?.[0]?.delta;
    if (!delta) return;
    const piece = typeof delta.content === "string" ? delta.content : "";
    if (piece) {
      content += piece;
      onDelta(piece);
    }
    const thought = typeof delta.reasoning_content === "string" ? delta.reasoning_content : "";
    if (thought) reasoning += thought;
  };

  try {
    while (!done) {
      const { value, done: streamDone } = await reader.read();
      if (streamDone) break;
      buffer += decoder.decode(value, { stream: true });
      let newline;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        handleLine(line);
        if (done) break;
      }
    }
    if (!done && buffer.trim()) handleLine(buffer);
    buffer += decoder.decode();
    if (!done && buffer.trim()) handleLine(buffer);
  } catch (error) {
    if (error?.name === "AbortError" || signal?.aborted) {
      const reason = signal?.reason;
      if (reason && reason.code === "timeout") {
        throw new ApiError("请求超时了，可能是网络不太稳定。", "timeout");
      }
      throw new ApiError("已停止回复", "aborted");
    }
    throw new ApiError("读取回复时网络断开了。", "network");
  } finally {
    try {
      reader.releaseLock();
    } catch {}
  }

  if (!content && !reasoning && parsedLines > 0) {
    throw new ApiError("模型没有返回内容，再试一次吧。", "empty");
  }
  if (!content && reasoning) {
    throw new ApiError("模型只返回了思考过程，没有最终回复。", "empty");
  }

  return { content, reasoning, model: responseModel };
}

async function listModels({ baseUrl, apiKey, fetchImpl = globalThis.fetch }) {
  if (!apiKey) throw new ApiError("还没有配置 API Key", "no_key");
  if (!baseUrl) throw new ApiError("还没有配置 API 地址", "no_base_url");
  let response;
  try {
    response = await fetchImpl(`${normalizeBaseUrl(baseUrl)}/models`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
    });
  } catch (error) {
    const message = String(error?.message || error || "");
    if (/fetch failed|network|ECONN|ENOTFOUND|ETIMEDOUT|socket/i.test(message)) {
      throw new ApiError("网络连接失败，请检查网络或代理设置。", "network");
    }
    throw new ApiError(message || "网络请求失败", "network");
  }
  if (!response.ok) {
    throw parseUpstreamError(response.status, await readErrorBody(response));
  }
  let json;
  try {
    json = await response.json();
  } catch {
    throw new ApiError("模型列表的响应格式不正确。", "bad_response");
  }
  const all = Array.isArray(json?.data) ? json.data : Array.isArray(json) ? json : [];
  const models = all
    .map((item) => (typeof item === "string" ? item : item?.id))
    .filter((id) => typeof id === "string" && id.trim())
    .map((id) => id.trim())
    .filter((id) => !/image|embedding|tts|whisper|dall-e|sora|video|audio/i.test(id));
  return Array.from(new Set(models));
}

module.exports = {
  ApiError,
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
  maskKey,
  readDshApiKey,
  streamChat,
  listModels,
  normalizeBaseUrl,
};
