"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AgentSidebar } from "@/components/AgentSidebar";
import { AppHeader } from "@/components/AppHeader";
import { ChatInput } from "@/components/ChatInput";
import { ChatWindow } from "@/components/ChatWindow";
import { MaterialPicker } from "@/components/MaterialPicker";
import { ModelBadge } from "@/components/ModelBadge";
import { StudentProfilePanel } from "@/components/StudentProfilePanel";
import { Skeleton } from "@/components/ui/skeleton";
import { AGENTS } from "@/lib/agents";
import {
  chatApi,
  materialsApi,
  metaApi,
  sendMessageStream,
  studentApi,
} from "@/lib/api";
import type {
  AgentType,
  ChatMessage,
  Citation,
  FollowUp,
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
  const chatModel = configQuery.data?.models.default;

  const session = useMemo(
    () => sessionsQuery.data?.find((s) => s.id === sessionId),
    [sessionsQuery.data, sessionId],
  );
  const agentType: AgentType = (session?.agent_type ??
    "head_teacher") as AgentType;
  const agent = AGENTS[agentType];

  const [streamingText, setStreamingText] = useState("");
  const [streamingCitations, setStreamingCitations] = useState<Citation[]>([]);
  const [streamingFollowUps, setStreamingFollowUps] = useState<FollowUp[]>([]);
  const [streamingWarning, setStreamingWarning] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [optimisticMessages, setOptimisticMessages] = useState<ChatMessage[]>([]);
  const [selectedMaterialIds, setSelectedMaterialIds] = useState<string[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  const messages = useMemo(() => {
    const base = messagesQuery.data ?? [];
    return [...base, ...optimisticMessages];
  }, [messagesQuery.data, optimisticMessages]);

  const send = useCallback(
    async (content: string, options: { materialIds?: string[] } = {}) => {
      if (!sessionId || isStreaming) return;
      const effectiveMaterialIds = options.materialIds ?? selectedMaterialIds;

      const localUserMsg: ChatMessage = {
        session_id: sessionId,
        role: "user",
        content,
        created_at: new Date().toISOString(),
        metadata: effectiveMaterialIds.length
          ? { material_ids: effectiveMaterialIds }
          : undefined,
      };
      setOptimisticMessages((prev) => [...prev, localUserMsg]);
      setStreamingText("");
      setStreamingCitations([]);
      setStreamingFollowUps([]);
      setStreamingWarning(null);
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
              setIsStreaming(false);
              abortRef.current = null;
            },
          },
          { materialIds: effectiveMaterialIds },
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
        setIsStreaming(false);
        abortRef.current = null;
      }
    },
    [sessionId, isStreaming, queryClient, selectedMaterialIds],
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

  // 会话不存在时,跳回 dashboard
  if (sessionsQuery.data && !session) {
    router.replace("/dashboard");
    return null;
  }

  const loading = messagesQuery.isLoading || sessionsQuery.isLoading;

  return (
    <div className="flex h-screen flex-col bg-app-gradient">
      <AppHeader />
      <div className="flex flex-1 overflow-hidden">
        <AgentSidebar
          className="hidden w-72 shrink-0 border-r border-border/60 bg-background/70 md:flex"
          currentSessionId={sessionId}
          currentAgent={agentType}
          sessions={sessionsQuery.data ?? []}
        />

        <div className="flex flex-1 flex-col">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 bg-background/70 px-4 py-2 backdrop-blur sm:px-6">
            <div className="flex items-center gap-2 text-sm">
              <span className="flex h-6 w-6 items-center justify-center rounded-md bg-foreground text-xs text-background">
                {agent.emoji}
              </span>
              <span className="font-semibold">{agent.displayName}</span>
              <span className="hidden text-xs text-muted-foreground sm:inline">
                · {agent.role}
              </span>
            </div>
            {chatModel && <ModelBadge model={chatModel} label="对话" />}
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
              <ChatWindow
                agentType={agentType}
                messages={messages}
                streamingText={streamingText}
                streamingCitations={streamingCitations}
                streamingFollowUps={streamingFollowUps}
                isStreaming={isStreaming}
                modelLabel={chatModel}
                onFollowUpClick={(q) => send(q)}
              />
            </>
          )}
          <ChatInput
            agent={agent}
            disabled={isStreaming || !sessionId}
            onSend={(text) => send(text)}
            onStop={stop}
            showStarters={messages.length <= 1 && !isStreaming}
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
          modelLabel={chatModel}
        />
      </div>
    </div>
  );
}
