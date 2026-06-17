"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AgentSidebar } from "@/components/AgentSidebar";
import { AppHeader } from "@/components/AppHeader";
import { ChatInput } from "@/components/ChatInput";
import { ChatWindow } from "@/components/ChatWindow";
import { MaterialPicker } from "@/components/MaterialPicker";
import { ModelSelector } from "@/components/ModelSelector";
import { StudentProfilePanel } from "@/components/StudentProfilePanel";
import { Skeleton } from "@/components/ui/skeleton";
import { resolveAgentMeta } from "@/lib/agents";
import {
  chatApi,
  materialsApi,
  metaApi,
  notesApi,
  sendMessageStream,
  studentApi,
} from "@/lib/api";
import { useAgents } from "@/lib/hooks/useAgents";
import type {
  AgentType,
  ChatMessage,
  Citation,
  FollowUp,
  ModelTierId,
  WebSearchEvent,
} from "@/lib/types";

export default function ChatSessionPage() {
  const params = useParams<{ sessionId: string }>();
  const sessionId = params.sessionId;
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();

  const sessionsQuery = useQuery({
    queryKey: ["chat-sessions"],
    queryFn: chatApi.listSessions,
  });

  const profileQuery = useQuery({
    queryKey: ["profile"],
    queryFn: studentApi.getProfile,
  });

  const messagesQuery = useQuery({
    queryKey: ["chat-messages", sessionId],
    queryFn: () => chatApi.listMessages(sessionId),
    enabled: !!sessionId,
  });

  const materialsQuery = useQuery({
    queryKey: ["materials"],
    queryFn: materialsApi.list,
  });

  const configQuery = useQuery({
    queryKey: ["meta-config"],
    queryFn: metaApi.config,
    staleTime: 5 * 60_000,
  });
  const tiers = configQuery.data?.model_tiers;
  const defaultTier: ModelTierId =
    configQuery.data?.default_tier ?? "medium";

  const session = useMemo(
    () => sessionsQuery.data?.find((s) => s.id === sessionId),
    [sessionsQuery.data, sessionId],
  );
  const agentType: AgentType = (session?.agent_type ??
    "head_teacher") as AgentType;
  const agentsQuery = useAgents();
  const agent = useMemo(
    () => resolveAgentMeta(agentType, agentsQuery.data),
    [agentType, agentsQuery.data],
  );

  const [streamingText, setStreamingText] = useState("");
  const [streamingCitations, setStreamingCitations] = useState<Citation[]>([]);
  const [streamingFollowUps, setStreamingFollowUps] = useState<FollowUp[]>([]);
  const [streamingWarning, setStreamingWarning] = useState<string | null>(null);
  const [streamingWebSearch, setStreamingWebSearch] =
    useState<WebSearchEvent | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [optimisticMessages, setOptimisticMessages] = useState<ChatMessage[]>([]);
  const [selectedMaterialIds, setSelectedMaterialIds] = useState<string[]>([]);
  // Phase 5.5: 联网搜索 toggle (按 agent 记忆)
  const [webSearch, setWebSearch] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const webSearchAvailable = configQuery.data?.web_search_enabled ?? false;

  // 按 agent type 持久化 web search toggle (与 modelTier 同一套机制)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem(`web_search:${agentType}`);
    setWebSearch(stored === "1");
  }, [agentType]);

  const toggleWebSearch = useCallback(
    (next: boolean) => {
      setWebSearch(next);
      if (typeof window !== "undefined") {
        window.localStorage.setItem(
          `web_search:${agentType}`,
          next ? "1" : "0",
        );
      }
    },
    [agentType],
  );

  // Phase 5: 老师有 default_material_ids 时,进入对话默认勾上
  // 当 dynamic agent data 第一次出现(且未手动改过)时填充
  const materialsInitRef = useRef(false);
  useEffect(() => {
    if (materialsInitRef.current) return;
    if (!agent.defaultMaterialIds) return;
    if (agent.defaultMaterialIds.length === 0) return;
    if (selectedMaterialIds.length > 0) {
      materialsInitRef.current = true;
      return;
    }
    setSelectedMaterialIds([...agent.defaultMaterialIds]);
    materialsInitRef.current = true;
  }, [agent.defaultMaterialIds, selectedMaterialIds.length]);

  // Phase 3.5: 模型档位 — 按 agent type 记忆到 localStorage,跨 session 也保留
  const [selectedTier, setSelectedTier] = useState<ModelTierId | null>(null);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem(`model_tier:${agentType}`);
    if (stored) setSelectedTier(stored as ModelTierId);
    else setSelectedTier(null);
  }, [agentType]);
  function pickTier(t: ModelTierId) {
    setSelectedTier(t);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(`model_tier:${agentType}`, t);
    }
  }
  // 用于传给 chat header 顶部显示和 send 时的实际 tier
  const effectiveTier: ModelTierId = selectedTier ?? defaultTier;
  const effectiveModel =
    tiers?.find((t) => t.tier === effectiveTier)?.model ??
    configQuery.data?.models.default;

  const messages = useMemo(() => {
    const base = messagesQuery.data ?? [];
    return [...base, ...optimisticMessages];
  }, [messagesQuery.data, optimisticMessages]);

  const send = useCallback(
    async (
      content: string,
      options: { materialIds?: string[]; imagePaths?: string[] } = {},
    ) => {
      if (!sessionId || isStreaming) return;
      const effectiveMaterialIds = options.materialIds ?? selectedMaterialIds;
      const effectiveImagePaths = options.imagePaths ?? [];

      const localMeta: ChatMessage["metadata"] = {};
      if (effectiveMaterialIds.length) localMeta.material_ids = effectiveMaterialIds;
      if (effectiveImagePaths.length) localMeta.image_urls = effectiveImagePaths;

      const localUserMsg: ChatMessage = {
        session_id: sessionId,
        role: "user",
        content,
        created_at: new Date().toISOString(),
        metadata: Object.keys(localMeta).length ? localMeta : undefined,
      };
      setOptimisticMessages((prev) => [...prev, localUserMsg]);
      setStreamingText("");
      setStreamingCitations([]);
      setStreamingFollowUps([]);
      setStreamingWarning(null);
      setStreamingWebSearch(null);
      setIsStreaming(true);

      const ctrl = new AbortController();
      abortRef.current = ctrl;

      try {
        await sendMessageStream(
          sessionId,
          content,
          {
            onDelta: (text) => setStreamingText((prev) => prev + text),
            onCitations: (items) => setStreamingCitations(items),
            onFollowUps: (items) => setStreamingFollowUps(items),
            onWarning: (msg) => setStreamingWarning(msg),
            onWebSearch: (ev) => setStreamingWebSearch(ev),
            onDone: async () => {
              await queryClient.invalidateQueries({
                queryKey: ["chat-messages", sessionId],
              });
              await queryClient.invalidateQueries({
                queryKey: ["chat-sessions"],
              });
              setOptimisticMessages([]);
              setStreamingText("");
              setStreamingCitations([]);
              setStreamingFollowUps([]);
              setStreamingWarning(null);
              setStreamingWebSearch(null);
              setIsStreaming(false);
              abortRef.current = null;
            },
            onError: (msg) => {
              setOptimisticMessages((prev) => [
                ...prev,
                {
                  session_id: sessionId,
                  role: "assistant",
                  content: `⚠️ ${msg}`,
                },
              ]);
              setStreamingText("");
              setStreamingCitations([]);
              setStreamingFollowUps([]);
              setStreamingWarning(null);
              setStreamingWebSearch(null);
              setIsStreaming(false);
              abortRef.current = null;
            },
          },
          {
            materialIds: effectiveMaterialIds,
            modelTier: selectedTier ?? undefined,
            imageUrls: effectiveImagePaths.length ? effectiveImagePaths : undefined,
            webSearch: webSearch && webSearchAvailable,
          },
          ctrl.signal,
        );
      } catch (err) {
        if ((err as Error).name === "AbortError") {
          setOptimisticMessages((prev) => [
            ...prev,
            {
              session_id: sessionId,
              role: "assistant",
              content: "(已停止生成)",
            },
          ]);
        }
        setStreamingText("");
        setStreamingCitations([]);
        setStreamingFollowUps([]);
        setStreamingWarning(null);
        setStreamingWebSearch(null);
        setIsStreaming(false);
        abortRef.current = null;
      }
    },
    [
      sessionId,
      isStreaming,
      queryClient,
      selectedMaterialIds,
      selectedTier,
      webSearch,
      webSearchAvailable,
    ],
  );

  function stop() {
    abortRef.current?.abort();
  }

  // Phase 3:从 Dashboard 任务卡过来时,URL 带 ?prompt=xxx → 自动发送一次
  const autoPromptedRef = useRef(false);
  useEffect(() => {
    if (autoPromptedRef.current) return;
    if (!sessionId || isStreaming) return;
    if (messagesQuery.isLoading) return; // 等历史消息加载完再判断
    const promptParam = searchParams?.get("prompt");
    if (!promptParam) return;
    // 仅当当前会话还没有用户消息时才自动发送 (避免刷新二次触发)
    const hasUserMsg = (messagesQuery.data ?? []).some((m) => m.role === "user");
    if (hasUserMsg) {
      // 已经有用户消息,清掉 query 即可
      router.replace(`/chat/${sessionId}`);
      autoPromptedRef.current = true;
      return;
    }
    autoPromptedRef.current = true;
    const decoded = decodeURIComponent(promptParam);
    // 先清 URL,再发送,避免 send 过程中的 re-render 重复触发
    router.replace(`/chat/${sessionId}`);
    void send(decoded);
  }, [
    sessionId,
    isStreaming,
    messagesQuery.isLoading,
    messagesQuery.data,
    searchParams,
    router,
    send,
  ]);

  // 会话不存在时回退 dashboard — 只有 sessionsQuery 真的拉完了 (非首屏 / 非 fetching)
  // 且确认列表里没有这个 id 时才跳。否则会因为 stale cache 误判,把刚从 Dashboard 创建
  // 后跳过来的新会话错误地踢回 dashboard,造成"点了任务又跳回当前页"。
  useEffect(() => {
    if (!sessionsQuery.isFetched) return;
    if (sessionsQuery.isFetching) return;
    if (!sessionsQuery.data) return;
    if (session) return;
    router.replace("/dashboard");
  }, [
    sessionsQuery.isFetched,
    sessionsQuery.isFetching,
    sessionsQuery.data,
    session,
    router,
  ]);

  const loading = messagesQuery.isLoading || sessionsQuery.isLoading;

  return (
    // 移动端关键:
    //   1. h-dvh 而非 h-screen 一一 iOS Safari 100vh 包含会自动隐藏的 chrome 栏,
    //      会把 ChatInput 推到可见区外。dvh 是 dynamic viewport height,实时跟随。
    //   2. overflow-x-hidden 一一 兜底防止任何子元素 (长 URL / 大表格) 撑出横向滚动,
    //      导致整个页面左右晃动、找不到发送按钮。
    <div className="flex h-dvh flex-col overflow-x-hidden bg-app-gradient">
      <AppHeader />
      <div className="flex flex-1 overflow-hidden">
        <AgentSidebar
          className="hidden w-72 shrink-0 border-r border-border/60 bg-background/70 md:flex"
          currentSessionId={sessionId}
          currentAgent={agentType}
          sessions={sessionsQuery.data ?? []}
        />

        <div className="flex min-w-0 flex-1 flex-col">
          {/*
            chat header 必须 relative + z-30:否则 ModelSelector 的 popover
            会被下方 ChatWindow 容器(overflow-y-auto 自带新 stacking context)
            盖住,即使 popover 自己 z-40 也救不回来 — 因为不同 sibling 的
            stacking context 独立。
          */}
          <div className="relative z-30 flex flex-wrap items-center justify-between gap-2 border-b border-border/60 bg-background/70 px-4 py-2 backdrop-blur sm:px-6">
            <div className="flex items-center gap-2 text-sm">
              <span className="flex h-6 w-6 items-center justify-center rounded-md bg-foreground text-xs text-background">
                {agent.emoji}
              </span>
              <span className="font-semibold">{agent.displayName}</span>
              <span className="hidden text-xs text-muted-foreground sm:inline">
                · {agent.role}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <SessionToNoteButton
                sessionId={sessionId}
                messageCount={messages.length}
                disabled={isStreaming}
              />
              <ModelSelector
                tiers={tiers}
                value={selectedTier}
                onChange={pickTier}
                disabled={isStreaming}
              />
            </div>
          </div>
          {loading ? (
            <div className="flex-1 space-y-4 p-6">
              <Skeleton className="h-12 w-2/3" />
              <Skeleton className="h-20 w-1/2" />
              <Skeleton className="h-20" />
            </div>
          ) : (
            <>
              {streamingWarning && (
                <div className="border-b border-accent-foreground/10 bg-accent px-4 py-2 text-xs text-accent-foreground">
                  {streamingWarning}
                </div>
              )}
              {streamingWebSearch && (
                <WebSearchBanner event={streamingWebSearch} />
              )}
              <ChatWindow
                agentType={agentType}
                messages={messages}
                streamingText={streamingText}
                streamingCitations={streamingCitations}
                streamingFollowUps={streamingFollowUps}
                isStreaming={isStreaming}
                modelLabel={effectiveModel}
                onFollowUpClick={(q) => send(q)}
              />
            </>
          )}
          <ChatInput
            agent={agent}
            disabled={isStreaming || !sessionId}
            onSend={(text, imagePaths) => send(text, { imagePaths })}
            onStop={stop}
            showStarters={messages.length <= 1 && !isStreaming}
            webSearch={webSearch}
            onWebSearchChange={toggleWebSearch}
            webSearchAvailable={webSearchAvailable}
            picker={
              <MaterialPicker
                materials={materialsQuery.data ?? []}
                isLoading={materialsQuery.isLoading}
                selectedIds={selectedMaterialIds}
                onChange={setSelectedMaterialIds}
              />
            }
          />
        </div>

        <StudentProfilePanel
          profile={profileQuery.data ?? null}
          agent={agent}
          modelLabel={effectiveModel}
        />
      </div>
    </div>
  );
}

// Phase 5.5: 联网搜索进度条 — searching / done / error 三态
function WebSearchBanner({ event }: { event: WebSearchEvent }) {
  if (event.status === "searching") {
    return (
      <div className="flex items-center gap-2 border-b border-primary/15 bg-primary/5 px-4 py-1.5 text-xs text-primary">
        <Loader2Icon />
        <span className="font-medium">正在联网搜索…</span>
        {event.query && (
          <span className="truncate text-muted-foreground">
            「{event.query.slice(0, 60)}
            {event.query.length > 60 ? "…" : ""}」
          </span>
        )}
      </div>
    );
  }
  if (event.status === "done") {
    const count = event.count ?? 0;
    if (count === 0) {
      return (
        <div className="border-b border-amber-200/40 bg-amber-50/60 px-4 py-1.5 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
          联网搜索完成,但未找到相关网页;本次将基于通识回答。
        </div>
      );
    }
    return (
      <div className="flex items-center gap-2 border-b border-primary/15 bg-primary/5 px-4 py-1.5 text-xs text-primary">
        <GlobeIcon />
        <span className="font-medium">
          联网拿到 {count} 条网页
          {event.response_time_ms ? `(${event.response_time_ms} ms)` : ""}
        </span>
      </div>
    );
  }
  if (event.status === "error") {
    return (
      <div className="border-b border-destructive/30 bg-destructive/5 px-4 py-1.5 text-xs text-destructive">
        联网搜索失败:{event.message || "未知错误"}。本次将仅基于本地资料/笔记回答。
      </div>
    );
  }
  return null;
}

function Loader2Icon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="animate-spin"
      aria-hidden
    >
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}

function GlobeIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M2 12h20" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}

/**
 * 「📝 整理整段对话为笔记」按钮 — 复用 notesApi.createFromSession。
 * - 状态:idle / generating / saved (短暂)
 * - 成功后 invalidate notes cache + 跳到 /notes/{id}
 * - 至少有 2 条消息才允许点(welcome + 至少 1 轮交互)
 */
function SessionToNoteButton({
  sessionId,
  messageCount,
  disabled,
}: {
  sessionId: string;
  messageCount: number;
  disabled?: boolean;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  // welcome 消息也算一条;真正能蒸馏的需要至少有 user 1 + assistant 1
  const tooShort = messageCount < 2;
  const isDisabled = disabled || status === "saving" || tooShort;

  async function handleClick() {
    if (isDisabled) return;
    setStatus("saving");
    setError(null);
    try {
      const note = await notesApi.createFromSession({ session_id: sessionId });
      queryClient.invalidateQueries({ queryKey: ["notes"] });
      queryClient.setQueryData(["note", note.id], note);
      router.push(`/notes/${note.id}`);
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "整理失败,请重试");
      // 5s 后回到 idle 让用户能再点
      setTimeout(() => {
        setStatus("idle");
        setError(null);
      }, 5000);
    }
  }

  const title = tooShort
    ? "对话太短,先聊几轮再整理"
    : status === "saving"
      ? "AI 正在蒸馏整段对话…"
      : status === "error"
        ? error || "整理失败"
        : "把整段对话蒸馏成一份汇总笔记";

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isDisabled}
      title={title}
      className={
        status === "error"
          ? "flex items-center gap-1.5 rounded-full border border-destructive/40 bg-destructive/5 px-3 py-1 text-xs text-destructive transition disabled:opacity-60"
          : "flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1 text-xs text-muted-foreground transition hover:border-primary/40 hover:bg-primary/5 hover:text-primary disabled:cursor-not-allowed disabled:opacity-60"
      }
    >
      {status === "saving" ? <Loader2Icon /> : <NotebookIcon />}
      <span className="hidden sm:inline">
        {status === "saving"
          ? "整理中…"
          : status === "error"
            ? "整理失败"
            : "整理为笔记"}
      </span>
    </button>
  );
}

function NotebookIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" />
      <path d="M2 6h2" />
      <path d="M2 10h2" />
      <path d="M2 14h2" />
      <path d="M2 18h2" />
    </svg>
  );
}
