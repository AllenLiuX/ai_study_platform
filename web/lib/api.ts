"use client";

import { createSupabaseBrowserClient } from "./supabase/client";
import type {
  AttemptResult,
  ChatMessage,
  ChatSession,
  Citation,
  CreateNoteRequest,
  CreatePracticeSessionRequest,
  CreateUserAgentRequest,
  DailyTasksResponse,
  DashboardResponse,
  FinishSessionResponse,
  AdminBreakdown,
  AdminMe,
  AdminOverview,
  AdminTopUser,
  AdminTrend,
  AdminUserRow,
  FollowUp,
  GeneratedAgentSpec,
  GenerateRoadmapRequest,
  Group,
  LearningRoadmap,
  MyPlan,
  PlanTier,
  QuotaExceededDetail,
  RoadmapNodeStatus,
  GroupDetail,
  GroupMember,
  CreateGroupRequest,
  UpdateGroupRequest,
  HintResponse,
  KnowledgeNote,
  Material,
  MaterialType,
  ModelTierId,
  ModelTierInfo,
  NextQuestionResponse,
  PracticeQuestion,
  PracticeSession,
  PracticeSessionStatus,
  StudentProfile,
  Subject,
  SubmitAttemptRequest,
  UpdateNoteRequest,
  UpdateUserAgentRequest,
  UserAgent,
  WebSearchEvent,
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

// -----------------------------------------------------------------------------
// 统一错误 & 402 QuotaError (Phase 8)
// -----------------------------------------------------------------------------
/**
 * 402 Payment Required — 免费额度打完了 / 想用 Pro 独占的模型档.
 *
 * 后端 detail 是一个结构化对象 (见 QuotaExceededDetail).
 * 前端可以 `err instanceof QuotaError` 分支处理; 同时我们全局 dispatch
 * `quota-exceeded` 事件, <UpgradeGate> 一次性 mount 就能收到并弹窗.
 */
export class QuotaError extends Error {
  detail: QuotaExceededDetail;
  status = 402;
  constructor(detail: QuotaExceededDetail) {
    super(detail.message);
    this.name = "QuotaError";
    this.detail = detail;
  }
}

function isQuotaDetail(d: unknown): d is QuotaExceededDetail {
  return !!d && typeof d === "object" && "limit_key" in (d as object);
}

/**
 * 从 (status, JSON body) 生成合适的错误对象.
 * - 402 且 body.detail 是结构化 quota detail → QuotaError + 全局 event
 * - 其他 → Error(detail.message || detail || `请求失败 <code>`)
 */
function makeApiError(status: number, body: unknown): Error {
  // 提取 detail 字段 (FastAPI HTTPException 都塞在 body.detail)
  const raw =
    body && typeof body === "object" && "detail" in body
      ? (body as { detail: unknown }).detail
      : body;

  if (status === 402 && isQuotaDetail(raw)) {
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent<QuotaExceededDetail>("quota-exceeded", { detail: raw }),
      );
    }
    return new QuotaError(raw);
  }

  // 通用 fallback: raw 可能是字符串, 也可能是对象 {message: "..."}
  let text: string;
  if (typeof raw === "string") text = raw;
  else if (raw && typeof raw === "object" && "message" in raw)
    text = String((raw as { message: unknown }).message);
  else text = `请求失败 ${status}`;
  return new Error(text);
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
      let bodyJson: unknown;
      try {
        bodyJson = await resp.json();
      } catch {
        /* ignore */
      }
      throw makeApiError(resp.status, bodyJson);
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
  /** Phase 5.5: 对话联网搜索是否启用 (后端是否配了 TAVILY_API_KEY) */
  web_search_enabled?: boolean;
  web_search_provider?: string | null;
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
/** Phase 4: 图片附件上传返回结构 */
export interface ChatAttachment {
  storage_path: string;
  mime_type: string;
  size_bytes: number;
  original_filename: string;
}

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
  deleteSession: (sessionId: string) =>
    request<void>(`/api/chat/sessions/${sessionId}`, { method: "DELETE" }),
  listMessages: (sessionId: string) =>
    request<ChatMessage[]>(`/api/chat/sessions/${sessionId}/messages`),
  /** Phase 4: 上传一张题目图片到 chat-attachments bucket,返回 storage_path */
  uploadAttachment: async (file: File): Promise<ChatAttachment> => {
    const token = await getAccessToken();
    const form = new FormData();
    form.set("file", file);
    const resp = await fetch(`${API_BASE}/api/chat/attachments`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
    });
    if (!resp.ok) {
      let bodyJson: unknown;
      try {
        bodyJson = await resp.json();
      } catch {
        /* ignore */
      }
      throw makeApiError(resp.status, bodyJson);
    }
    return (await resp.json()) as ChatAttachment;
  },
  /** Phase 4: 给前端用,把 storage_path 转回 Storage 签名 URL 用于回显缩略图 */
  getAttachmentSignedUrl: async (storagePath: string): Promise<string | null> => {
    const supabase = createSupabaseBrowserClient();
    const { data, error } = await supabase.storage
      .from("chat-attachments")
      .createSignedUrl(storagePath, 60 * 60); // 1h 有效,够长用于浏览
    if (error || !data) return null;
    return data.signedUrl;
  },
};

// -----------------------------------------------------------------------------
// Materials (Phase 1)
// -----------------------------------------------------------------------------
export type MaterialsScope = "personal" | "group" | "all";

export const materialsApi = {
  list: (opts: { scope?: MaterialsScope; group_id?: string } = {}) => {
    const params = new URLSearchParams();
    if (opts.scope && opts.scope !== "personal") params.set("scope", opts.scope);
    if (opts.group_id) params.set("group_id", opts.group_id);
    const qs = params.toString();
    return request<Material[]>(`/api/materials${qs ? `?${qs}` : ""}`);
  },
  get: (id: string) => request<Material>(`/api/materials/${id}`),
  delete: (id: string) =>
    request<void>(`/api/materials/${id}`, { method: "DELETE" }),
  upload: async (file: File, fields: {
    title?: string;
    subject_id?: string | null;
    grade?: string | null;
    material_type?: MaterialType;
    /** Phase 7: 上传到某个群 (可选;不传就是个人库) */
    group_id?: string | null;
  } = {}): Promise<Material> => {
    const token = await getAccessToken();
    const form = new FormData();
    form.set("file", file);
    if (fields.title) form.set("title", fields.title);
    if (fields.subject_id) form.set("subject_id", fields.subject_id);
    if (fields.grade) form.set("grade", fields.grade);
    if (fields.material_type) form.set("material_type", fields.material_type);
    if (fields.group_id) form.set("group_id", fields.group_id);

    const resp = await fetch(`${API_BASE}/api/materials`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
    });
    if (!resp.ok) {
      let bodyJson: unknown;
      try {
        bodyJson = await resp.json();
      } catch {
        /* ignore */
      }
      throw makeApiError(resp.status, bodyJson);
    }
    return (await resp.json()) as Material;
  },
};

// -----------------------------------------------------------------------------
// Agents (Phase 5: 自定义老师)
// -----------------------------------------------------------------------------
export const agentsApi = {
  list: () => request<UserAgent[]>("/api/agents"),
  get: (agentKey: string) => request<UserAgent>(`/api/agents/${agentKey}`),
  create: (payload: CreateUserAgentRequest) =>
    request<UserAgent>("/api/agents", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  update: (agentKey: string, payload: UpdateUserAgentRequest) =>
    request<UserAgent>(`/api/agents/${agentKey}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  delete: (agentKey: string) =>
    request<void>(`/api/agents/${agentKey}`, { method: "DELETE" }),
  /** 让 LLM 根据自然语言描述帮我生成老师配置 (Phase 5 创建表单的"AI 帮我生成"按钮) */
  generateSpec: (description: string, domains: string[] = []) =>
    request<GeneratedAgentSpec>("/api/agents/_generate", {
      method: "POST",
      body: JSON.stringify({ description, domains }),
      timeoutMs: 60_000, // LLM 生成可能较慢
    }),
};

// -----------------------------------------------------------------------------
// Dynamic learning roadmaps (Phase 9)
// -----------------------------------------------------------------------------
export const roadmapsApi = {
  list: () => request<LearningRoadmap[]>("/api/roadmaps"),
  get: (roadmapId: string) =>
    request<LearningRoadmap>(`/api/roadmaps/${roadmapId}`),
  generate: (payload: GenerateRoadmapRequest) =>
    request<LearningRoadmap>("/api/roadmaps/generate", {
      method: "POST",
      body: JSON.stringify(payload),
      timeoutMs: 90_000,
    }),
  update: (
    roadmapId: string,
    payload: Partial<{
      title: string;
      weekly_hours: number;
      target_date: string | null;
      agent_key: string | null;
      status: LearningRoadmap["status"];
    }>,
  ) =>
    request<LearningRoadmap>(`/api/roadmaps/${roadmapId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  updateNode: (
    roadmapId: string,
    nodeId: string,
    payload: { status?: RoadmapNodeStatus; mastery?: number },
  ) =>
    request<LearningRoadmap>(
      `/api/roadmaps/${roadmapId}/nodes/${encodeURIComponent(nodeId)}`,
      {
        method: "PATCH",
        body: JSON.stringify(payload),
      },
    ),
};

// -----------------------------------------------------------------------------
// Notes (Phase 5: 笔记 = 私有知识点)
// -----------------------------------------------------------------------------
export type NotesScope = "personal" | "group" | "all";

export const notesApi = {
  list: (opts: {
    agent_key?: string;
    tag?: string;
    scope?: NotesScope;
    group_id?: string;
  } = {}) => {
    const params = new URLSearchParams();
    if (opts.agent_key) params.set("agent_key", opts.agent_key);
    if (opts.tag) params.set("tag", opts.tag);
    if (opts.scope && opts.scope !== "personal") params.set("scope", opts.scope);
    if (opts.group_id) params.set("group_id", opts.group_id);
    const qs = params.toString();
    return request<KnowledgeNote[]>(`/api/notes${qs ? `?${qs}` : ""}`);
  },
  get: (id: string) => request<KnowledgeNote>(`/api/notes/${id}`),
  create: (payload: CreateNoteRequest) =>
    request<KnowledgeNote>("/api/notes", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  /** Phase 5: 从 chat assistant 消息蒸馏笔记 (LLM 提取) */
  createFromMessage: (
    payload: { message_id: string; parent_id?: string | null; tags?: string[] | null },
  ) =>
    request<KnowledgeNote>("/api/notes/from_message", {
      method: "POST",
      body: JSON.stringify(payload),
      timeoutMs: 45_000,
    }),
  /** Phase 5: 把整段对话蒸馏成一份汇总笔记 */
  createFromSession: (
    payload: { session_id: string; parent_id?: string | null; tags?: string[] | null },
  ) =>
    request<KnowledgeNote>("/api/notes/from_session", {
      method: "POST",
      body: JSON.stringify(payload),
      timeoutMs: 90_000, // 整段 session 可能更长,放宽超时
    }),
  /** Phase 6.1: 把一次练习 (题目+作答+解析) 蒸馏成复习笔记 */
  createFromPractice: (
    payload: {
      practice_session_id: string;
      parent_id?: string | null;
      tags?: string[] | null;
    },
  ) =>
    request<KnowledgeNote>("/api/notes/from_practice", {
      method: "POST",
      body: JSON.stringify(payload),
      timeoutMs: 90_000,
    }),
  update: (id: string, payload: UpdateNoteRequest) =>
    request<KnowledgeNote>(`/api/notes/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  delete: (id: string) =>
    request<void>(`/api/notes/${id}`, { method: "DELETE" }),
  review: (id: string, score: number) =>
    request<KnowledgeNote>(`/api/notes/${id}/review`, {
      method: "POST",
      body: JSON.stringify({ score }),
    }),
};

// -----------------------------------------------------------------------------
// Phase 6.2: 听课 (Lecture) — 录音实时转写 + 保存为复习笔记
// -----------------------------------------------------------------------------
export interface TranscribeResponse {
  text: string;
  chars: number;
}

export const lectureApi = {
  /** 上传一段音频 (webm / mp4 / m4a / wav ...) → 返回 Whisper 转写文本 */
  transcribeChunk: async (
    blob: Blob,
    opts: { filename?: string; signal?: AbortSignal } = {},
  ): Promise<TranscribeResponse> => {
    const token = await getAccessToken();
    const form = new FormData();
    // 后端从后缀推 content-type,filename 要有正确扩展名
    const filename = opts.filename ?? "chunk.webm";
    form.set("file", blob, filename);
    const resp = await fetch(`${API_BASE}/api/lecture/transcribe`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
      signal: opts.signal,
    });
    if (!resp.ok) {
      let bodyJson: unknown;
      try {
        bodyJson = await resp.json();
      } catch {
        /* ignore */
      }
      throw makeApiError(resp.status, bodyJson);
    }
    return (await resp.json()) as TranscribeResponse;
  },
  /** 把累积的完整转写 + 可选标题提示送后端 LLM 蒸馏成 KnowledgeNote */
  saveAsNote: (payload: {
    transcript: string;
    title_hint?: string | null;
    /** Phase 6.2+: 可选,让某位"老师"参与蒸馏 (用其人设/风格组织笔记) */
    agent_key?: string | null;
    /** Phase 6.2+: 可选,用户的关注角度/学习目标 (自由文本,LLM 按此侧重) */
    focus_hint?: string | null;
    tags?: string[] | null;
    parent_id?: string | null;
    keep_raw_transcript?: boolean;
  }) =>
    request<KnowledgeNote>("/api/lecture/save", {
      method: "POST",
      body: JSON.stringify(payload),
      timeoutMs: 120_000, // 整节课蒸馏可能较慢
    }),
};

// -----------------------------------------------------------------------------
// Phase 6: 练习模块
// -----------------------------------------------------------------------------
export const practiceApi = {
  list: (opts: { status?: PracticeSessionStatus; limit?: number } = {}) => {
    const params = new URLSearchParams();
    if (opts.status) params.set("status", opts.status);
    if (opts.limit) params.set("limit", String(opts.limit));
    const qs = params.toString();
    return request<PracticeSession[]>(`/api/practice/sessions${qs ? `?${qs}` : ""}`);
  },
  get: (id: string) => request<PracticeSession>(`/api/practice/sessions/${id}`),
  create: (payload: CreatePracticeSessionRequest) =>
    request<PracticeSession>("/api/practice/sessions", {
      method: "POST",
      body: JSON.stringify(payload),
      timeoutMs: 60_000, // LLM 生成 plan 可能慢
    }),
  delete: (id: string) =>
    request<void>(`/api/practice/sessions/${id}`, { method: "DELETE" }),
  listQuestions: (sessionId: string) =>
    request<PracticeQuestion[]>(`/api/practice/sessions/${sessionId}/questions`),
  nextQuestion: (sessionId: string) =>
    request<NextQuestionResponse>(`/api/practice/sessions/${sessionId}/next`, {
      method: "POST",
      timeoutMs: 60_000,
    }),
  submitAttempt: (questionId: string, payload: SubmitAttemptRequest) =>
    request<AttemptResult>(`/api/practice/questions/${questionId}/attempt`, {
      method: "POST",
      body: JSON.stringify(payload),
      timeoutMs: 45_000, // short 题 LLM 评分较慢
    }),
  hint: (questionId: string, hint_level: number) =>
    request<HintResponse>(`/api/practice/questions/${questionId}/hint`, {
      method: "POST",
      body: JSON.stringify({ hint_level }),
      timeoutMs: 30_000,
    }),
  finish: (sessionId: string) =>
    request<FinishSessionResponse>(`/api/practice/sessions/${sessionId}/finish`, {
      method: "POST",
      timeoutMs: 60_000,
    }),
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
  /** Phase 5.5: 联网搜索进度事件 (searching / done / error) */
  onWebSearch?: (event: WebSearchEvent) => void;
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
  /** Phase 4: 题目图片附件,值是 chat-attachments bucket 内的 storage_path 列表 */
  imageUrls?: string[];
  /** Phase 5.5: 本条消息是否启用联网搜索 (前端 Globe toggle 控制) */
  webSearch?: boolean;
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
  if (options.imageUrls && options.imageUrls.length > 0) {
    body.image_urls = options.imageUrls;
  }
  if (options.webSearch) {
    body.web_search = true;
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
    let bodyJson: unknown;
    try {
      bodyJson = await resp.json();
    } catch {
      /* ignore */
    }
    const err = makeApiError(resp.status, bodyJson);
    handlers.onError?.(err.message);
    throw err;
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
        else if (event === "web_search") handlers.onWebSearch?.(payload as WebSearchEvent);
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

// -----------------------------------------------------------------------------
// Groups (Phase 7: 群组 / 班级)
// -----------------------------------------------------------------------------
export const groupsApi = {
  /** 我加入的所有群 */
  mine: () => request<Group[]>("/api/groups/mine"),
  /** 搜索公开群 (仅 is_public=true) */
  search: (q?: string) =>
    request<Group[]>(
      `/api/groups/search${q ? `?q=${encodeURIComponent(q)}` : ""}`,
    ),
  /** 群详情 (必须是成员;含 my_role + 成员预览 + 内容计数) */
  get: (groupId: string) => request<GroupDetail>(`/api/groups/${groupId}`),
  /** 完整成员列表 */
  members: (groupId: string) =>
    request<GroupMember[]>(`/api/groups/${groupId}/members`),
  /** 建群 */
  create: (payload: CreateGroupRequest) =>
    request<Group>("/api/groups", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  /** 群主改群信息 */
  update: (groupId: string, payload: UpdateGroupRequest) =>
    request<Group>(`/api/groups/${groupId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  /** 群主解散群 */
  remove: (groupId: string) =>
    request<void>(`/api/groups/${groupId}`, { method: "DELETE" }),
  /** 靠邀请码加群 (私密群唯一途径;公开群也可) */
  joinByCode: (code: string) =>
    request<Group>("/api/groups/join", {
      method: "POST",
      body: JSON.stringify({ invite_code: code }),
    }),
  /** 直接加入某个公开群 */
  joinPublic: (groupId: string) =>
    request<Group>(`/api/groups/${groupId}/join`, { method: "POST" }),
  /** 退群 (群主除外) */
  leave: (groupId: string) =>
    request<void>(`/api/groups/${groupId}/leave`, { method: "POST" }),
  /** 踢人 (仅 owner/admin) */
  kick: (groupId: string, userId: string) =>
    request<void>(`/api/groups/${groupId}/members/${userId}`, {
      method: "DELETE",
    }),
};

// -----------------------------------------------------------------------------
// Admin (Phase 7.1: 产品后台看板)
// -----------------------------------------------------------------------------
export const adminApi = {
  /** 任何登录用户可调, 用于前端条件展示"后台"入口 */
  me: () => request<AdminMe>("/api/admin/me"),
  overview: () => request<AdminOverview>("/api/admin/overview"),
  trend: (days: number = 30) => request<AdminTrend>(`/api/admin/trend?days=${days}`),
  breakdown: () => request<AdminBreakdown>("/api/admin/breakdown"),
  users: (limit: number = 50) =>
    request<{ users: AdminUserRow[] }>(`/api/admin/users?limit=${limit}`),
  topUsers: (limit: number = 10) =>
    request<{ users: AdminTopUser[] }>(`/api/admin/top-users?limit=${limit}`),
};

// -----------------------------------------------------------------------------
// Billing / Entitlements (Phase 8)
// -----------------------------------------------------------------------------
export const billingApi = {
  /** 当前登录用户的 plan + 各项限额 + 当前用量 */
  myPlan: () => request<MyPlan>("/api/me/plan"),
};

// Admin: 给指定用户设 plan (需 admin 权限)
export const adminBillingApi = {
  setPlan: (
    userId: string,
    payload: {
      plan: PlanTier;
      expires_at?: string | null;
      note?: string | null;
    },
  ) =>
    request<{
      user_id: string;
      plan: PlanTier;
      raw_plan: PlanTier;
      expires_at: string | null;
      granted_at: string | null;
      note: string | null;
    }>(`/api/admin/users/${userId}/plan`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
};
