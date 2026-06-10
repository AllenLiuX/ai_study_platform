"use client";

import {
  ArrowRight,
  Compass,
  FileText,
  Loader2,
  PencilLine,
  RotateCcw,
  Sparkles,
  User,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { MarkdownMessage } from "@/components/MarkdownMessage";
import { AGENTS } from "@/lib/agents";
import { chatApi } from "@/lib/api";
import type {
  AgentType,
  ChatMessage,
  Citation,
  FollowUp,
  FollowUpType,
} from "@/lib/types";
import { cn } from "@/lib/utils";

interface ChatWindowProps {
  agentType: AgentType;
  messages: ChatMessage[];
  streamingText?: string;
  streamingCitations?: Citation[];
  streamingFollowUps?: FollowUp[];
  isStreaming: boolean;
  /** 当前驱动的 LLM 型号,例如 gpt-4o-mini。仅做展示用 */
  modelLabel?: string;
  onFollowUpClick?: (question: string) => void;
}

export function ChatWindow({
  agentType,
  messages,
  streamingText = "",
  streamingCitations,
  streamingFollowUps,
  isStreaming,
  modelLabel,
  onFollowUpClick,
}: ChatWindowProps) {
  const agent = AGENTS[agentType];
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages, streamingText, streamingFollowUps]);

  // 最后一条 assistant 消息的索引 (用于决定在哪里渲染 follow_ups)
  const lastAssistantIdx = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "assistant") return i;
    }
    return -1;
  })();

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto scrollbar-thin">
      <div className="mx-auto flex max-w-3xl flex-col gap-5 px-4 py-6 sm:px-6 sm:py-8">
        {messages.length === 0 && !isStreaming && (
          <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center shadow-card">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-foreground text-2xl text-background">
              {agent.emoji}
            </div>
            <h3 className="text-lg font-semibold tracking-tight">
              和 {agent.displayName} 打个招呼吧
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {agent.tagline}
            </p>
            {modelLabel && (
              <div className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-primary/15 bg-primary/5 px-2.5 py-1 text-[11px] font-medium text-primary">
                <Sparkles className="h-3 w-3" />
                由 {modelLabel} 实时生成
              </div>
            )}
          </div>
        )}

        {messages.map((msg, idx) => {
          const isLastAssistant = idx === lastAssistantIdx;
          const persistedFollowUps = msg.metadata?.follow_ups as
            | FollowUp[]
            | undefined;
          const showFollowUps =
            isLastAssistant &&
            !isStreaming &&
            persistedFollowUps &&
            persistedFollowUps.length > 0;
          return (
            <div key={msg.id ?? idx} className="space-y-2">
              <MessageBubble
                message={msg}
                agentType={agentType}
                modelLabel={modelLabel}
              />
              {showFollowUps && (
                <FollowUpRow
                  items={persistedFollowUps!}
                  onClick={onFollowUpClick}
                />
              )}
            </div>
          );
        })}

        {isStreaming && (
          <div className="space-y-2">
            <MessageBubble
              message={{
                session_id: "streaming",
                role: "assistant",
                content: streamingText || "正在思考…",
                metadata: streamingCitations
                  ? { citations: streamingCitations }
                  : undefined,
              }}
              agentType={agentType}
              modelLabel={modelLabel}
              isStreaming
            />
            {streamingText && !streamingFollowUps && (
              <div className="ml-12 inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-[11px] text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin text-primary" />
                AI 正在准备「接下来可以问什么」…
              </div>
            )}
            {streamingFollowUps && streamingFollowUps.length > 0 && (
              <FollowUpRow
                items={streamingFollowUps}
                onClick={onFollowUpClick}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const FOLLOW_UP_CONFIG: Record<
  FollowUpType,
  { label: string; icon: typeof ArrowRight }
> = {
  deep_dive: { label: "继续深入", icon: ArrowRight },
  explore: { label: "拓展课题", icon: Compass },
  practice: { label: "做道题", icon: PencilLine },
  review: { label: "巩固薄弱", icon: RotateCcw },
};

function FollowUpRow({
  items,
  onClick,
}: {
  items: FollowUp[];
  onClick?: (question: string) => void;
}) {
  return (
    <div className="ml-12 flex flex-col gap-2 animate-fade-in">
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Sparkles className="h-3 w-3 text-primary" />
        <span>接下来你也可以问：</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {items.map((f, i) => {
          const cfg = FOLLOW_UP_CONFIG[f.type] ?? FOLLOW_UP_CONFIG.deep_dive;
          const Icon = cfg.icon;
          return (
            <button
              key={`${f.type}-${i}`}
              type="button"
              onClick={() => onClick?.(f.question)}
              className={cn(
                "group inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition",
                "border-primary/20 bg-primary/5 text-foreground hover:border-primary/40 hover:bg-primary/10",
              )}
              title={f.reason || cfg.label}
            >
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-primary">
                <Icon className="h-3 w-3" />
                {cfg.label}
              </span>
              <span className="text-muted-foreground/40">·</span>
              <span className="font-medium">{f.question}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function MessageBubble({
  message,
  agentType,
  isStreaming = false,
  modelLabel,
}: {
  message: ChatMessage;
  agentType: AgentType;
  isStreaming?: boolean;
  modelLabel?: string;
}) {
  const isUser = message.role === "user";
  const agent = AGENTS[agentType];
  const citations =
    (message.metadata?.citations as Citation[] | undefined) ?? [];
  const imagePaths =
    (message.metadata?.image_urls as string[] | undefined) ?? [];
  const isPlaceholder =
    isStreaming && (message.content === "正在思考…" || message.content === "");
  const messageModel =
    (message.metadata?.model as string | undefined) || modelLabel;

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
            ? "border border-border bg-secondary text-secondary-foreground"
            : "bg-foreground text-background",
        )}
        aria-hidden
      >
        {isUser ? <User className="h-4 w-4" /> : <span>{agent.emoji}</span>}
      </div>
      <div
        className={cn(
          "max-w-[78ch] rounded-2xl px-4 py-3 text-sm leading-relaxed",
          isUser
            ? "bg-primary text-primary-foreground shadow-sm"
            : "border border-border bg-card shadow-card",
        )}
      >
        {isUser && imagePaths.length > 0 && (
          <ChatMessageImages paths={imagePaths} />
        )}
        {isPlaceholder ? (
          <span className="inline-flex items-center gap-1.5 text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
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

        {!isUser && !isPlaceholder && messageModel && (
          <div className="mt-2 flex items-center gap-1 text-[11px] text-muted-foreground/80">
            <Sparkles className="h-3 w-3 text-primary/70" />
            <span>由 {messageModel} 生成</span>
          </div>
        )}
      </div>
    </div>
  );
}

/** Phase 4: 题目图片缩略图 — 自动用 signed URL 拉取并显示 */
function ChatMessageImages({ paths }: { paths: string[] }) {
  const [urls, setUrls] = useState<(string | null)[]>([]);

  useEffect(() => {
    let mounted = true;
    setUrls(paths.map(() => null));
    Promise.all(paths.map((p) => chatApi.getAttachmentSignedUrl(p))).then(
      (arr) => {
        if (mounted) setUrls(arr);
      },
    );
    return () => {
      mounted = false;
    };
  }, [paths]);

  return (
    <div className="mb-2 flex flex-wrap gap-2">
      {paths.map((p, i) => {
        const url = urls[i];
        return (
          <a
            key={p}
            href={url ?? undefined}
            target="_blank"
            rel="noreferrer"
            className={cn(
              "block h-24 w-24 overflow-hidden rounded-lg border bg-background",
              "border-white/30 hover:border-white/60 transition",
            )}
            title={url ? "点击查看大图" : "图片加载中"}
          >
            {url ? (
              // 用 native img 而不是 next/image,signed URL 太多 host 不好配置
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={url}
                alt="题目截图"
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-primary-foreground/70">
                <Loader2 className="h-4 w-4 animate-spin" />
              </div>
            )}
          </a>
        );
      })}
    </div>
  );
}

function CitationList({ citations }: { citations: Citation[] }) {
  return (
    <div className="surface-ai mt-3 rounded-xl border px-3 py-2 text-xs">
      <div className="mb-1.5 flex items-center gap-1.5 text-primary">
        <FileText className="h-3 w-3" />
        <span className="font-medium">
          基于你的资料回答 · 引用了 {citations.length} 段
        </span>
      </div>
      <ol className="flex flex-col gap-1">
        {citations.map((c, i) => (
          <li
            key={`${c.material_id}-${c.chunk_index}-${i}`}
            className="flex items-start gap-1.5 text-muted-foreground"
          >
            <span className="mt-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded bg-primary/10 px-1 text-[10px] font-semibold text-primary">
              {i + 1}
            </span>
            <span className="flex-1 truncate">
              《{c.material_title}》第 {c.chunk_index + 1} 段
              <span className="ml-1 text-muted-foreground/60">
                · 相似度 {(c.similarity * 100).toFixed(0)}%
              </span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
