"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Loader2, MessageCircle, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  AGENTS,
  AGENT_ORDER,
  getAgentMeta,
  userAgentToMeta,
} from "@/lib/agents";
import { chatApi } from "@/lib/api";
import { useAgents } from "@/lib/hooks/useAgents";
import type {
  AgentType,
  ChatMessage,
  ChatSession,
  UserAgent,
} from "@/lib/types";
import { cn } from "@/lib/utils";

interface AgentSidebarProps {
  currentSessionId: string;
  currentAgent: AgentType;
  sessions: ChatSession[];
  className?: string;
}

export function AgentSidebar({
  currentSessionId,
  currentAgent,
  sessions,
  className,
}: AgentSidebarProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const agentsQuery = useAgents();
  const [openingKey, setOpeningKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Phase 5: 区分平台老师 / 用户老师;后端已按 owner_type platform → user 排序
  // 兜底:DB 拿不到时(老用户首次访问 / 离线),仍把内置 4 个老师显示出来
  const allAgents: UserAgent[] = agentsQuery.data ?? [];
  const platformAgents = allAgents.filter(
    (a) => a.owner_type === "platform" && a.is_active,
  );
  const userAgents = allAgents.filter(
    (a) => a.owner_type === "user" && a.is_active,
  );

  // 当 DB 没数据时(API 还没响应 / 接口挂了),用 hardcoded builtin 兜底
  const usingFallback = platformAgents.length === 0;
  const fallbackPlatform = AGENT_ORDER.map((key) => AGENTS[key]);

  async function startNew(key: AgentType, subjectId: string | null = null) {
    if (openingKey) return;
    setOpeningKey(key);
    setError(null);
    try {
      const session = await chatApi.createSession({
        agent_type: key,
        subject_id: subjectId,
      });
      // 立刻写进 cache,避免 chat 页判定 session 不存在被踢回 dashboard
      queryClient.setQueryData<ChatSession[]>(["chat-sessions"], (prev) => {
        const list = prev ? [...prev] : [];
        return [session, ...list.filter((s) => s.id !== session.id)];
      });
      queryClient.setQueryData<ChatMessage[]>(
        ["chat-messages", session.id],
        [],
      );
      router.push(`/chat/${session.id}`);
    } catch (err) {
      setOpeningKey(null);
      setError(err instanceof Error ? err.message : "无法创建对话");
    }
  }

  return (
    <aside
      className={cn(
        "flex h-full flex-col gap-4 overflow-y-auto p-4 scrollbar-thin",
        className,
      )}
    >
      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      <div className="space-y-2">
        <div className="px-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          AI 老师
        </div>
        {usingFallback
          ? fallbackPlatform.map((meta) => (
              <AgentButton
                key={meta.type}
                agentKey={meta.type}
                emoji={meta.emoji}
                displayName={meta.displayName}
                tagline={meta.tagline}
                isActive={currentAgent === meta.type}
                busy={openingKey === meta.type}
                onClick={() => startNew(meta.type, meta.subjectId)}
              />
            ))
          : platformAgents.map((a) => (
              <AgentButton
                key={a.agent_key}
                agentKey={a.agent_key}
                emoji={a.emoji || userAgentToMeta(a).emoji}
                displayName={a.display_name}
                tagline={a.tagline || a.role || userAgentToMeta(a).tagline}
                isActive={currentAgent === a.agent_key}
                busy={openingKey === a.agent_key}
                onClick={() => startNew(a.agent_key, a.subject_id ?? null)}
              />
            ))}
      </div>

      {userAgents.length > 0 && (
        <div className="space-y-2 border-t border-border/60 pt-3">
          <div className="flex items-center justify-between px-2">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              我的自定义老师
            </div>
            <Link
              href="/agents"
              className="text-[11px] text-muted-foreground transition hover:text-primary"
              title="管理自定义老师"
            >
              管理
            </Link>
          </div>
          {userAgents.map((a) => (
            <AgentButton
              key={a.agent_key}
              agentKey={a.agent_key}
              emoji={a.emoji || "🎓"}
              displayName={a.display_name}
              tagline={a.tagline || a.role || "—"}
              isActive={currentAgent === a.agent_key}
              busy={openingKey === a.agent_key}
              isCustom
              onClick={() => startNew(a.agent_key, a.subject_id ?? null)}
            />
          ))}
        </div>
      )}

      {!agentsQuery.isLoading && userAgents.length === 0 && (
        <Link
          href="/agents/new"
          className="flex items-center justify-center gap-1.5 rounded-xl border border-dashed border-border px-3 py-2 text-xs text-muted-foreground transition hover:border-primary/40 hover:text-primary"
        >
          <Plus className="h-3 w-3" />
          创建自定义老师
        </Link>
      )}

      <div className="flex-1 space-y-2 border-t border-border/60 pt-4">
        <div className="px-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          历史对话
        </div>
        {sessions.length === 0 ? (
          <p className="px-2 text-xs text-muted-foreground">暂无历史</p>
        ) : (
          <ul className="space-y-1">
            {sessions.map((s) => {
              const agent = getAgentMeta(s.agent_type);
              const isActive = s.id === currentSessionId;
              return (
                <li key={s.id}>
                  <Link
                    href={`/chat/${s.id}`}
                    className={cn(
                      "flex items-start gap-2.5 rounded-xl px-3 py-2 text-sm transition",
                      isActive
                        ? "bg-primary/10 text-primary"
                        : "hover:bg-secondary",
                    )}
                  >
                    <span className="mt-0.5 text-base">{agent.emoji}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">
                        {s.title || agent.displayName}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {agent.displayName}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <Link
        href="/dashboard"
        className="inline-flex h-10 w-full items-center justify-start gap-2 rounded-xl border border-border bg-transparent px-4 text-sm font-medium transition hover:bg-secondary"
      >
        <MessageCircle className="h-4 w-4" />
        回到驾驶舱
      </Link>
    </aside>
  );
}

function AgentButton({
  emoji,
  displayName,
  tagline,
  isActive,
  busy,
  isCustom,
  onClick,
}: {
  agentKey: string;
  emoji: string;
  displayName: string;
  tagline: string;
  isActive: boolean;
  busy: boolean;
  isCustom?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={cn(
        "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition disabled:opacity-60",
        isActive ? "bg-primary/10 text-primary" : "hover:bg-secondary",
      )}
    >
      <span
        className={cn(
          "flex h-9 w-9 items-center justify-center rounded-xl border text-base transition",
          isActive
            ? "border-primary/30 bg-primary/10 text-primary"
            : "border-border bg-secondary text-foreground/80",
        )}
      >
        {emoji}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium">{displayName}</span>
          {isCustom && (
            <span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[9px] font-medium text-primary">
              自定义
            </span>
          )}
        </div>
        <div className="truncate text-xs text-muted-foreground">{tagline}</div>
      </div>
      {busy ? (
        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
      ) : (
        <Plus className="h-4 w-4 shrink-0 text-muted-foreground" />
      )}
    </button>
  );
}
