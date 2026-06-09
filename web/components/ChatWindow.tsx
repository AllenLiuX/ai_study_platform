"use client";

import { Bot, FileText, User } from "lucide-react";
import { useEffect, useRef } from "react";

import { MarkdownMessage } from "@/components/MarkdownMessage";
import { AGENTS } from "@/lib/agents";
import type { AgentType, ChatMessage, Citation } from "@/lib/types";
import { cn } from "@/lib/utils";

interface ChatWindowProps {
  agentType: AgentType;
  messages: ChatMessage[];
  streamingText?: string;
  streamingCitations?: Citation[];
  isStreaming: boolean;
}

export function ChatWindow({
  agentType,
  messages,
  streamingText = "",
  streamingCitations,
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
              metadata: streamingCitations ? { citations: streamingCitations } : undefined,
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
  const citations = (message.metadata?.citations as Citation[] | undefined) ?? [];
  const isPlaceholder =
    isStreaming && (message.content === "正在思考…" || message.content === "");

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
        {isPlaceholder ? (
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            正在思考
            <span className="inline-flex gap-0.5">
              <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:-0.3s]" />
              <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:-0.15s]" />
              <span className="h-1 w-1 animate-bounce rounded-full bg-current" />
            </span>
          </span>
        ) : (
          <MarkdownMessage
            content={message.content}
            variant={isUser ? "user" : "assistant"}
          />
        )}

        {isStreaming && !isPlaceholder && (
          <span className="ml-0.5 inline-block h-3 w-1.5 animate-pulse rounded-sm bg-current align-middle opacity-60" />
        )}

        {!isUser && citations.length > 0 && (
          <CitationList citations={citations} />
        )}
      </div>
    </div>
  );
}

function CitationList({ citations }: { citations: Citation[] }) {
  return (
    <div className="mt-3 border-t border-border/60 pt-2 text-xs">
      <div className="mb-1 flex items-center gap-1 text-muted-foreground">
        <FileText className="h-3 w-3" />
        <span>引用了 {citations.length} 段资料</span>
      </div>
      <ol className="flex flex-col gap-1">
        {citations.map((c, i) => (
          <li
            key={`${c.material_id}-${c.chunk_index}-${i}`}
            className="flex items-start gap-1.5 text-muted-foreground"
          >
            <span className="mt-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded bg-secondary px-1 text-[10px] font-semibold text-secondary-foreground">
              {i + 1}
            </span>
            <span className="flex-1 truncate">
              《{c.material_title}》第 {c.chunk_index + 1} 段
              <span className="ml-1 text-foreground/40">
                · 相似度 {(c.similarity * 100).toFixed(0)}%
              </span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
