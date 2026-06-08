"use client";

import { Bot, User } from "lucide-react";
import { useEffect, useRef } from "react";

import { AGENTS } from "@/lib/agents";
import type { AgentType, ChatMessage } from "@/lib/types";
import { cn } from "@/lib/utils";

interface ChatWindowProps {
  agentType: AgentType;
  messages: ChatMessage[];
  streamingText?: string;
  isStreaming: boolean;
}

export function ChatWindow({
  agentType,
  messages,
  streamingText = "",
  isStreaming,
}: ChatWindowProps) {
  const agent = AGENTS[agentType];
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages, streamingText]);

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto scrollbar-thin">
      <div className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-6 sm:px-6 sm:py-8">
        {messages.length === 0 && !isStreaming && (
          <div className="rounded-2xl border border-dashed border-border/80 p-8 text-center">
            <div
              className={cn(
                "mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br text-2xl text-white",
                agent.gradient,
              )}
            >
              {agent.emoji}
            </div>
            <h3 className="text-lg font-semibold">
              和 {agent.displayName} 打个招呼吧
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {agent.tagline}
            </p>
          </div>
        )}

        {messages.map((msg, idx) => (
          <MessageBubble key={msg.id ?? idx} message={msg} agentType={agentType} />
        ))}

        {isStreaming && (
          <MessageBubble
            message={{
              session_id: "streaming",
              role: "assistant",
              content: streamingText || "正在思考…",
            }}
            agentType={agentType}
            isStreaming
          />
        )}
      </div>
    </div>
  );
}

function MessageBubble({
  message,
  agentType,
  isStreaming = false,
}: {
  message: ChatMessage;
  agentType: AgentType;
  isStreaming?: boolean;
}) {
  const isUser = message.role === "user";
  const agent = AGENTS[agentType];

  return (
    <div
      className={cn(
        "flex items-start gap-3 animate-fade-in",
        isUser && "flex-row-reverse",
      )}
    >
      <div
        className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-base",
          isUser
            ? "bg-secondary text-secondary-foreground"
            : `bg-gradient-to-br text-white ${agent.gradient}`,
        )}
      >
        {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
      </div>
      <div
        className={cn(
          "max-w-[78ch] rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-sm",
          isUser
            ? "bg-primary text-primary-foreground"
            : "border border-border/60 bg-card",
        )}
      >
        <pre className="whitespace-pre-wrap break-words font-sans">
          {message.content}
          {isStreaming && (
            <span className="ml-0.5 inline-block h-3 w-1.5 animate-pulse rounded-sm bg-primary align-middle" />
          )}
        </pre>
      </div>
    </div>
  );
}
