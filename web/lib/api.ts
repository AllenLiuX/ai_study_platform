"use client";

import { createSupabaseBrowserClient } from "./supabase/client";
import type {
  ChatMessage,
  ChatSession,
  DashboardResponse,
  StudentProfile,
  Subject,
} from "./types";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

async function getAccessToken(): Promise<string | null> {
  const supabase = createSupabaseBrowserClient();
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

async function request<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const token = await getAccessToken();
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const resp = await fetch(`${API_BASE}${path}`, { ...init, headers });
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
}

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
// SSE 发送消息
// -----------------------------------------------------------------------------
export interface SendMessageHandlers {
  onReady?: (info: { agent_type: string }) => void;
  onDelta: (text: string) => void;
  onDone?: (info: { length: number }) => void;
  onError?: (message: string) => void;
}

export async function sendMessageStream(
  sessionId: string,
  content: string,
  handlers: SendMessageHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const token = await getAccessToken();
  const resp = await fetch(
    `${API_BASE}/api/chat/sessions/${sessionId}/messages`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ content }),
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
        else if (event === "delta") handlers.onDelta(payload.text ?? "");
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
