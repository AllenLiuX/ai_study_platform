"use client";

import { MessageCircle, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { AGENTS, AGENT_ORDER } from "@/lib/agents";
import { chatApi } from "@/lib/api";
import type { AgentType, ChatSession } from "@/lib/types";
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

  async function startNew(type: AgentType) {
    try {
      const agent = AGENTS[type];
      const session = await chatApi.createSession({
        agent_type: type,
        subject_id: agent.subjectId,
      });
      router.push(`/chat/${session.id}`);
      router.refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : "无法创建对话");
    }
  }

  return (
    <aside
      className={cn(
        "flex h-full flex-col gap-4 overflow-y-auto p-4 scrollbar-thin",
        className,
      )}
    >
      <div className="space-y-2">
        <div className="px-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          AI 老师
        </div>
        {AGENT_ORDER.map((type) => {
          const agent = AGENTS[type];
          const isActive = currentAgent === type;
          return (
            <button
              key={type}
              type="button"
              onClick={() => startNew(type)}
              className={cn(
                "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition",
                isActive
                  ? "bg-primary/10 text-primary"
                  : "hover:bg-secondary",
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
                {agent.emoji}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">
                  {agent.displayName}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {agent.tagline}
                </div>
              </div>
              <Plus className="h-4 w-4 shrink-0 text-muted-foreground" />
            </button>
          );
        })}
      </div>

      <div className="flex-1 space-y-2 border-t border-border/60 pt-4">
        <div className="px-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          历史对话
        </div>
        {sessions.length === 0 ? (
          <p className="px-2 text-xs text-muted-foreground">暂无历史</p>
        ) : (
          <ul className="space-y-1">
            {sessions.map((s) => {
              const agent = AGENTS[s.agent_type];
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
        回到学习驾驶舱
      </Link>
    </aside>
  );
}
