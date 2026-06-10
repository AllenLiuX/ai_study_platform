"use client";

import { createSupabaseBrowserClient } from "./supabase/client";
import type {
  ChatMessage,
  ChatSession,
  Citation,
  DailyTasksResponse,
  DashboardResponse,
  FollowUp,
  Material,
  MaterialType,
  ModelTierId,
  ModelTierInfo,
  StudentProfile,
  Subject,
} from "./types";

// -----------------------------------------------------------------------------
// 后端 URL 解析:支持 local <-> online 一键切换
//
// 优先级:
//   1. NEXT_PUBLIC_API_MODE = "local" | "online" -> 用内置 preset (推荐)
//   2. NEXT_PUBLIC_API_BASE_URL -> 完全自定义 URL (向后兼容/逃生口)
//   3. 默认 "http://localhost:8000" (本地开发兜底)
//
// 使用方式:
//   - 本地开发打本地后端: 不设或 NEXT_PUBLIC_API_MODE=local
//   - 本地开发打线上后端: NEXT_PUBLIC_API_MODE=online
//   - Vercel 生产: NEXT_PUBLIC_API_MODE=online (build 时注入)
//
// 注意 NEXT_PUBLIC_* 在 Next.js 是 build-time 注入,改完要重新 build。
// -----------------------------------------------------------------------------
const API_PRESETS: Record<string, string> = {
  local: "http://localhost:8000",
  online: "https://aico-music.com:5443",
};

function resolveApiBase(): string {
  const mode = process.env.NEXT_PUBLIC_API_MODE?.toLowerCase();
  if (mode && API_PRESETS[mode]) return API_PRESETS[mode];
  return process.env.NEXT_PUBLIC_API_BASE_URL ?? API_PRESETS.local;
}

const API_BASE = resolveApiBase();

/** 给外部 (调试/UI badge) 暴露当前实际后端地址 */
export function getApiBase(): string {
  return API_BASE;
}

async function getAccessToken(): Promise<string | null> {
  const supabase = createSupabaseBrowserClient();
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

/**
 * 普通 REST 请求统一加 20s 超时 — 防止个别请求卡死整个交互
 * (例如 createSession 时 supabase 网络抖动,前面会看到"点了半天没反应")。
 * 调用方可以覆盖 timeoutMs 或传入自己的 signal。
 */
async function request<T>(
  path: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<T> {
  const { timeoutMs = 20_000, signal: externalSignal, ...rest } = init;
  const token = await getAccessToken();
  const headers = new Headers(rest.headers);
  headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);

  // 组合外部 signal 与内置 timeout signal
  const ctrl = new AbortController();
  const timeoutId = setTimeout(() => ctrl.abort(new Error("request timeout")), timeoutMs);
  if (externalSignal) {
    if (externalSignal.aborted) {
      ctrl.abort(externalSignal.reason);
    } else {
      externalSignal.addEventListener("abort", () => ctrl.abort(externalSignal.reason), {
        once: true,
      });
    }
  }

  try {
    const resp = await fetch(`${API_BASE}${path}`, {
      ...rest,
      headers,
      signal: ctrl.signal,
    });
    if (!resp.ok) {
      let detail: string | undefined;
      try {
        const body = await resp.json();
        detail = body.detail ?? body.message;
      } catch {
        // ignore
      }
      throw new Error(detail || `请求失败 ${resp.status}`);
    }
    if (resp.status === 204) return undefined as T;
    return (await resp.json()) as T;
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      throw new Error(`请求超时 (${Math.round(timeoutMs / 1000)}s),请检查网络后重试`);
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

// -----------------------------------------------------------------------------
// Meta (公开,无需登录;用于在 UI 中显示当前 AI 栈)
// -----------------------------------------------------------------------------
export interface ModelInfo {
  default: string;
  premium: string;
  embedding: string;
}

export interface HealthConfig {
  openai_configured: boolean;
  supabase_configured: boolean;
  models: ModelInfo;
  /** Phase 3.5: 5 档可选模型 */
  model_tiers?: ModelTierInfo[];
  default_tier?: ModelTierId;
  cors_origins: string[];
}

export const metaApi = {
  config: async (): Promise<HealthConfig> => {
    const resp = await fetch(`${API_BASE}/health/config`);
    if (!resp.ok) throw new Error(`health/config ${resp.status}`);
    return (await resp.json()) as HealthConfig;
  },
};

// -----------------------------------------------------------------------------
// Student
// -----------------------------------------------------------------------------
export const studentApi = {
  getProfile: () => request<StudentProfile>("/api/student/profile"),
  updateProfile: (payload: Partial<StudentProfile>) =>
    request<StudentProfile>("/api/student/profile", {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  getSubjects: () => request<Subject[]>("/api/student/subjects"),
  getDashboard: () => request<DashboardResponse>("/api/student/dashboard"),
  getTodayTasks: (refresh = false) =>
    request<DailyTasksResponse>(
      `/api/student/tasks/today${refresh ? "?refresh=true" : ""}`,
    ),
};

// -----------------------------------------------------------------------------
// Chat
// -----------------------------------------------------------------------------
export const chatApi = {
  listSessions: () => request<ChatSession[]>("/api/chat/sessions"),
  createSession: (payload: {
    agent_type: string;
    subject_id?: string | null;
    title?: string | null;
  }) =>
    request<ChatSession>("/api/chat/sessions", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  listMessages: (sessionId: string) =>
    request<ChatMessage[]>(`/api/chat/sessions/${sessionId}/messages`),
};

// -----------------------------------------------------------------------------
// Materials (Phase 1)
// -----------------------------------------------------------------------------
export const materialsApi = {
  list: () => request<Material[]>("/api/materials"),
  get: (id: string) => request<Material>(`/api/materials/${id}`),
  delete: (id: string) =>
    request<void>(`/api/materials/${id}`, { method: "DELETE" }),
  upload: async (file: File, fields: {
    title?: string;
    subject_id?: string | null;
    grade?: string | null;
    material_type?: MaterialType;
  } = {}): Promise<Material> => {
    const token = await getAccessToken();
    const form = new FormData();
    form.set("file", file);
    if (fields.title) form.set("title", fields.title);
    if (fields.subject_id) form.set("subject_id", fields.subject_id);
    if (fields.grade) form.set("grade", fields.grade);
    if (fields.material_type) form.set("material_type", fields.material_type);

    const resp = await fetch(`${API_BASE}/api/materials`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
    });
    if (!resp.ok) {
      let detail = `上传失败 ${resp.status}`;
      try {
        const body = await resp.json();
        detail = body.detail ?? body.message ?? detail;
      } catch {
        // ignore
      }
      throw new Error(detail);
    }
    return (await resp.json()) as Material;
  },
};

// -----------------------------------------------------------------------------
// SSE 发送消息
// -----------------------------------------------------------------------------
export interface SendMessageHandlers {
  onReady?: (info: { agent_type: string; model?: string }) => void;
  onCitations?: (citations: Citation[]) => void;
  onWarning?: (message: string) => void;
  onDelta: (text: string) => void;
  onFollowUps?: (items: FollowUp[]) => void;
  onDone?: (info: {
    length: number;
    citation_count?: number;
    model?: string;
  }) => void;
  onError?: (message: string) => void;
}

export interface SendMessageOptions {
  materialIds?: string[];
  /** Phase 3.5: 学生临时选择的模型档位,后端会覆盖 agent 默认 tier */
  modelTier?: ModelTierId | null;
}

export async function sendMessageStream(
  sessionId: string,
  content: string,
  handlers: SendMessageHandlers,
  options: SendMessageOptions = {},
  signal?: AbortSignal,
): Promise<void> {
  const token = await getAccessToken();
  const body: Record<string, unknown> = { content };
  if (options.materialIds && options.materialIds.length > 0) {
    body.material_ids = options.materialIds;
  }
  if (options.modelTier) {
    body.model_tier = options.modelTier;
  }
  const resp = await fetch(
    `${API_BASE}/api/chat/sessions/${sessionId}/messages`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
      signal,
    },
  );

  if (!resp.ok || !resp.body) {
    let detail = `请求失败 ${resp.status}`;
    try {
      const body = await resp.json();
      detail = body.detail ?? body.message ?? detail;
    } catch {
      // ignore
    }
    handlers.onError?.(detail);
    throw new Error(detail);
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let separatorIdx: number;
    while ((separatorIdx = buffer.indexOf("\n\n")) !== -1) {
      const rawEvent = buffer.slice(0, separatorIdx);
      buffer = buffer.slice(separatorIdx + 2);
      const parsed = parseSseEvent(rawEvent);
      if (!parsed) continue;
      const { event, data } = parsed;
      try {
        const payload = data ? JSON.parse(data) : {};
        if (event === "ready") handlers.onReady?.(payload);
        else if (event === "citations") handlers.onCitations?.(payload.items ?? []);
        else if (event === "warning") handlers.onWarning?.(payload.message ?? "");
        else if (event === "delta") handlers.onDelta(payload.text ?? "");
        else if (event === "follow_ups") handlers.onFollowUps?.(payload.items ?? []);
        else if (event === "done") handlers.onDone?.(payload);
        else if (event === "error") handlers.onError?.(payload.message ?? "服务异常");
      } catch (err) {
        // 个别 chunk 解析失败不致命
        console.warn("SSE parse failure", err, rawEvent);
      }
    }
  }
}

function parseSseEvent(raw: string): { event: string; data: string } | null {
  if (!raw.trim()) return null;
  let event = "message";
  const dataLines: string[] = [];
  for (const line of raw.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
  }
  return { event, data: dataLines.join("\n") };
}
