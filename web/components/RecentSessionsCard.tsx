"use client";

import { ArrowUpRight, MessagesSquare } from "lucide-react";
import Link from "next/link";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AGENTS } from "@/lib/agents";
import type { ChatSession } from "@/lib/types";
import { cn } from "@/lib/utils";

function formatTime(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "刚刚";
  if (diffMin < 60) return `${diffMin} 分钟前`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH} 小时前`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 7) return `${diffD} 天前`;
  return date.toLocaleDateString("zh-CN");
}

export function RecentSessionsCard({
  sessions,
}: {
  sessions: ChatSession[];
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="flex items-center gap-2">
          <MessagesSquare className="h-5 w-5 text-primary" />
          最近的对话
        </CardTitle>
        <span className="text-xs text-muted-foreground">
          {sessions.length > 0 ? `共 ${sessions.length} 条` : ""}
        </span>
      </CardHeader>
      <CardContent>
        {sessions.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            还没有对话记录。挑一位 AI 老师,问个问题开始吧 👇
          </p>
        ) : (
          <ul className="space-y-1">
            {sessions.map((s) => {
              const agent = AGENTS[s.agent_type];
              return (
                <li key={s.id}>
                  <Link
                    href={`/chat/${s.id}`}
                    className={cn(
                      "group flex items-center justify-between gap-3 rounded-xl px-3 py-2.5 transition hover:bg-secondary",
                    )}
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span
                        className={cn(
                          "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-base text-white",
                          agent.gradient,
                        )}
                      >
                        {agent.emoji}
                      </span>
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">
                          {s.title || `${agent.displayName} 的对话`}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {agent.displayName} · {formatTime(s.updated_at)}
                        </div>
                      </div>
                    </div>
                    <ArrowUpRight className="h-4 w-4 text-muted-foreground opacity-0 transition group-hover:opacity-100" />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
