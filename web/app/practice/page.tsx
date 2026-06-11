"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  Clock,
  Loader2,
  Plus,
  Target,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { resolveAgentMeta } from "@/lib/agents";
import { practiceApi } from "@/lib/api";
import { useAgents } from "@/lib/hooks/useAgents";
import type { PracticeSession } from "@/lib/types";
import { cn } from "@/lib/utils";

const STATUS_LABEL: Record<string, string> = {
  active: "进行中",
  finished: "已完成",
  abandoned: "已放弃",
};

export default function PracticePage() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<"all" | "active" | "finished">("all");

  const sessionsQuery = useQuery<PracticeSession[]>({
    queryKey: ["practice-sessions"],
    queryFn: () => practiceApi.list({ limit: 50 }),
  });

  const agentsQuery = useAgents();

  const sessions = (sessionsQuery.data ?? []).filter((s) =>
    filter === "all" ? true : s.status === filter,
  );

  const deleteMutation = useMutation({
    mutationFn: (id: string) => practiceApi.delete(id),
    onSuccess: (_, id) => {
      queryClient.setQueryData<PracticeSession[]>(
        ["practice-sessions"],
        (prev) => (prev ?? []).filter((s) => s.id !== id),
      );
    },
  });

  function handleDelete(e: React.MouseEvent, session: PracticeSession) {
    e.preventDefault();
    e.stopPropagation();
    if (deleteMutation.isPending) return;
    const ok = window.confirm(
      `确定删除练习「${session.topic}」?题目和作答记录都会丢失。`,
    );
    if (!ok) return;
    deleteMutation.mutate(session.id);
  }

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="container py-10">
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="flex items-center gap-2 text-3xl font-semibold tracking-tight">
              <Target className="h-7 w-7 text-primary" />
              针对性练习
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              选一位老师 + 一个知识点,系统给你出 AI 自适应题。做对升难度、做错降难度,
              不会的题可以请老师给提示。做完后会有知识点掌握度复盘。
            </p>
          </div>
          <Link href="/practice/new">
            <Button size="lg" className="gap-2">
              <Plus className="h-4 w-4" /> 新建练习
            </Button>
          </Link>
        </div>

        {/* 过滤器 */}
        <div className="mb-4 flex items-center gap-2 text-sm">
          {(["all", "active", "finished"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setFilter(k)}
              className={cn(
                "rounded-full px-3 py-1.5 transition",
                filter === k
                  ? "bg-primary text-primary-foreground"
                  : "border border-border/60 text-muted-foreground hover:bg-secondary",
              )}
            >
              {k === "all" ? "全部" : STATUS_LABEL[k]}
            </button>
          ))}
        </div>

        {/* 列表 */}
        {sessionsQuery.isLoading ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-32 animate-pulse rounded-2xl border border-border/60 bg-secondary/40"
              />
            ))}
          </div>
        ) : sessions.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-border/60 bg-secondary/30 p-12 text-center">
            <Target className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
            <h3 className="text-lg font-medium">还没练过任何题</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              选一位老师 + 一个知识点,开始一段针对性练习。
            </p>
            <Link href="/practice/new" className="mt-5 inline-block">
              <Button>开始第一次练习</Button>
            </Link>
          </div>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {sessions.map((s) => {
              const agent = resolveAgentMeta(s.agent_key, agentsQuery.data ?? []);
              const isFinished = s.status === "finished";
              const accuracy =
                s.answered_count > 0
                  ? Math.round((s.correct_count / s.answered_count) * 100)
                  : 0;
              const href = isFinished
                ? `/practice/${s.id}/summary`
                : `/practice/${s.id}`;
              return (
                <li key={s.id} className="group relative">
                  <Link
                    href={href}
                    className="block rounded-2xl border border-border/60 bg-card p-5 transition hover:border-primary/40 hover:shadow-sm"
                  >
                    <div className="mb-3 flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <span className="text-lg">{agent.emoji}</span>
                        <span>{agent.displayName}</span>
                      </div>
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[10px]",
                          isFinished
                            ? "bg-emerald-500/15 text-emerald-600"
                            : "bg-primary/15 text-primary",
                        )}
                      >
                        {STATUS_LABEL[s.status] ?? s.status}
                      </span>
                    </div>
                    <h3 className="line-clamp-2 text-base font-medium">{s.topic}</h3>
                    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Clock className="h-3.5 w-3.5" />
                        {s.target_minutes} 分钟
                      </span>
                      <span className="flex items-center gap-1">
                        <Target className="h-3.5 w-3.5" />
                        {s.answered_count} / {s.target_question_count} 题
                      </span>
                      {isFinished && s.answered_count > 0 ? (
                        <span className="flex items-center gap-1">
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                          正确率 {accuracy}%
                        </span>
                      ) : null}
                    </div>
                  </Link>
                  <button
                    type="button"
                    onClick={(e) => handleDelete(e, s)}
                    title="删除练习"
                    disabled={deleteMutation.isPending}
                    className={cn(
                      "absolute right-3 top-3 rounded-md p-1.5 text-muted-foreground transition",
                      "opacity-0 group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive",
                      "focus-visible:opacity-100",
                    )}
                  >
                    {deleteMutation.isPending && deleteMutation.variables === s.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5" />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </div>
  );
}
