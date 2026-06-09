"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useMemo, useRef, useState } from "react";

import { AgentSidebar } from "@/components/AgentSidebar";
import { AppHeader } from "@/components/AppHeader";
import { ChatInput } from "@/components/ChatInput";
import { ChatWindow } from "@/components/ChatWindow";
import { MaterialPicker } from "@/components/MaterialPicker";
import { StudentProfilePanel } from "@/components/StudentProfilePanel";
import { Skeleton } from "@/components/ui/skeleton";
import { AGENTS } from "@/lib/agents";
import { chatApi, materialsApi, sendMessageStream, studentApi } from "@/lib/api";
import type { AgentType, ChatMessage, Citation } from "@/lib/types";

export default function ChatSessionPage() {
  const params = useParams<{ sessionId: string }>();
  const sessionId = params.sessionId;
  const router = useRouter();
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

  const session = useMemo(
    () => sessionsQuery.data?.find((s) => s.id === sessionId),
    [sessionsQuery.data, sessionId],
  );
  const agentType: AgentType = (session?.agent_type ??
    "head_teacher") as AgentType;
  const agent = AGENTS[agentType];

  const [streamingText, setStreamingText] = useState("");
  const [streamingCitations, setStreamingCitations] = useState<Citation[]>([]);
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
          {loading ? (
            <div className="flex-1 space-y-4 p-6">
              <Skeleton className="h-12 w-2/3" />
              <Skeleton className="h-20 w-1/2" />
              <Skeleton className="h-20" />
            </div>
          ) : (
            <>
              {streamingWarning && (
                <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">
                  {streamingWarning}
                </div>
              )}
              <ChatWindow
                agentType={agentType}
                messages={messages}
                streamingText={streamingText}
                streamingCitations={streamingCitations}
                isStreaming={isStreaming}
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
        />
      </div>
    </div>
  );
}
