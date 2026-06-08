"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useMemo, useRef, useState } from "react";

import { AgentSidebar } from "@/components/AgentSidebar";
import { AppHeader } from "@/components/AppHeader";
import { ChatInput } from "@/components/ChatInput";
import { ChatWindow } from "@/components/ChatWindow";
import { StudentProfilePanel } from "@/components/StudentProfilePanel";
import { Skeleton } from "@/components/ui/skeleton";
import { AGENTS } from "@/lib/agents";
import { chatApi, sendMessageStream, studentApi } from "@/lib/api";
import type { AgentType, ChatMessage } from "@/lib/types";

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

  const session = useMemo(
    () => sessionsQuery.data?.find((s) => s.id === sessionId),
    [sessionsQuery.data, sessionId],
  );
  const agentType: AgentType = (session?.agent_type ??
    "head_teacher") as AgentType;
  const agent = AGENTS[agentType];

  const [streamingText, setStreamingText] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [optimisticMessages, setOptimisticMessages] = useState<ChatMessage[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  const messages = useMemo(() => {
    const base = messagesQuery.data ?? [];
    return [...base, ...optimisticMessages];
  }, [messagesQuery.data, optimisticMessages]);

  const send = useCallback(
    async (content: string) => {
      if (!sessionId || isStreaming) return;

      const localUserMsg: ChatMessage = {
        session_id: sessionId,
        role: "user",
        content,
        created_at: new Date().toISOString(),
      };
      setOptimisticMessages((prev) => [...prev, localUserMsg]);
      setStreamingText("");
      setIsStreaming(true);

      const ctrl = new AbortController();
      abortRef.current = ctrl;

      try {
        await sendMessageStream(
          sessionId,
          content,
          {
            onDelta: (text) => setStreamingText((prev) => prev + text),
            onDone: async () => {
              // 流结束后,重新拉最新消息以替换 optimistic
              await queryClient.invalidateQueries({
                queryKey: ["chat-messages", sessionId],
              });
              await queryClient.invalidateQueries({
                queryKey: ["chat-sessions"],
              });
              setOptimisticMessages([]);
              setStreamingText("");
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
              setIsStreaming(false);
              abortRef.current = null;
            },
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
        setIsStreaming(false);
        abortRef.current = null;
      }
    },
    [sessionId, isStreaming, queryClient],
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
            <ChatWindow
              agentType={agentType}
              messages={messages}
              streamingText={streamingText}
              isStreaming={isStreaming}
            />
          )}
          <ChatInput
            agent={agent}
            disabled={isStreaming || !sessionId}
            onSend={send}
            onStop={stop}
            showStarters={messages.length <= 1 && !isStreaming}
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
