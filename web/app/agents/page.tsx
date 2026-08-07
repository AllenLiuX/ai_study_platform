"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Edit3,
  Globe,
  GraduationCap,
  Loader2,
  Lock,
  MessageSquare,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { agentsApi, chatApi } from "@/lib/api";
import type { ChatMessage, ChatSession, UserAgent } from "@/lib/types";
import { cn } from "@/lib/utils";

export default function AgentsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [openingKey, setOpeningKey] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const agentsQuery = useQuery<UserAgent[]>({
    queryKey: ["agents"],
    queryFn: () => agentsApi.list(),
  });

  const deleteMutation = useMutation({
    mutationFn: (agentKey: string) => agentsApi.delete(agentKey),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agents"] });
      setDeleteError(null);
    },
    onError: (err) =>
      setDeleteError(err instanceof Error ? err.message : "删除失败"),
  });

  const publicMutation = useMutation({
    mutationFn: ({ agentKey, value }: { agentKey: string; value: boolean }) =>
      agentsApi.update(agentKey, { is_public: value }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agents"] });
      setDeleteError(null);
    },
    onError: (err) =>
      setDeleteError(err instanceof Error ? err.message : "操作失败"),
  });

  async function startChat(agent: UserAgent) {
    if (openingKey) return;
    setOpeningKey(agent.agent_key);
    try {
      const session = await chatApi.createSession({
        agent_type: agent.agent_key,
        subject_id: agent.subject_id ?? null,
      });
      // 把新 session push 到 cache,chat 页就不会判定为不存在
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
      console.error("startChat error", err);
      setOpeningKey(null);
      alert(err instanceof Error ? err.message : "无法开始对话");
    }
  }

  const list = agentsQuery.data ?? [];
  const platform = list.filter((a) => a.owner_type === "platform");
  const mine = list.filter((a) => a.owner_type === "user" && a.is_active);

  return (
    <div className="min-h-screen bg-app-gradient">
      <AppHeader />
      <div className="container py-8">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="mb-1 inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
              <GraduationCap className="h-3.5 w-3.5" />
              AI 老师
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">
              你的专属 AI 老师团
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              平台预设 4 位学科老师;你也可以为任何方向(系统设计 / 量化 / 兴趣自学…)
              创建一位专属老师 — AI 会基于你给的资料库帮你规划学习路径。
            </p>
          </div>
          <Link href="/agents/new">
            <Button size="lg">
              <Plus className="mr-1 h-4 w-4" />
              新建老师
            </Button>
          </Link>
        </div>

        {deleteError && (
          <p className="mb-4 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {deleteError}
          </p>
        )}

        {agentsQuery.isLoading ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-44 rounded-2xl" />
            ))}
          </div>
        ) : (
          <div className="space-y-8">
            <section>
              <div className="mb-2 text-sm font-medium text-muted-foreground">
                平台预设
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {platform.map((a) => (
                  <AgentCard
                    key={a.agent_key}
                    agent={a}
                    onStart={() => startChat(a)}
                    busy={openingKey === a.agent_key}
                    onDelete={null}
                  />
                ))}
              </div>
            </section>

            <section>
              <div className="mb-2 flex items-center justify-between">
                <div className="text-sm font-medium text-muted-foreground">
                  我创建的老师 ({mine.length})
                </div>
              </div>
              {mine.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border bg-card/40 p-8 text-center">
                  <Sparkles className="mx-auto mb-2 h-6 w-6 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    还没有自定义老师。点击右上角「新建老师」,或者直接告诉
                    AI「我要面试量化公司 ML Engineer」,AI 会帮你生成 system
                    prompt。
                  </p>
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {mine.map((a) => (
                    <AgentCard
                      key={a.agent_key}
                      agent={a}
                      onStart={() => startChat(a)}
                      busy={openingKey === a.agent_key}
                      onTogglePublic={() =>
                        publicMutation.mutate({
                          agentKey: a.agent_key,
                          value: !a.is_public,
                        })
                      }
                      onDelete={() => {
                        if (
                          !window.confirm(
                            `确定要删除老师"${a.display_name}"?已有的对话不会被删除,但不能再开新对话。`,
                          )
                        )
                          return;
                        deleteMutation.mutate(a.agent_key);
                      }}
                    />
                  ))}
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

function AgentCard({
  agent,
  onStart,
  busy,
  onDelete,
  onTogglePublic,
}: {
  agent: UserAgent;
  onStart: () => void;
  busy: boolean;
  onDelete: (() => void) | null;
  onTogglePublic?: (() => void) | null;
}) {
  const isPlatform = agent.owner_type === "platform";
  return (
    <div
      className={cn(
        "group relative flex flex-col rounded-2xl border bg-card p-4 shadow-card transition hover:border-primary/40",
        "border-border",
      )}
    >
      <div className="mb-3 flex items-start gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-foreground text-2xl text-background">
          {agent.emoji || "🎓"}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <h3 className="truncate text-base font-semibold">
              {agent.display_name}
            </h3>
            {!isPlatform && (
              <span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                自定义
              </span>
            )}
            {!isPlatform && agent.is_public && (
              <span className="inline-flex items-center gap-0.5 rounded-md bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
                <Globe className="h-2.5 w-2.5" />
                已公开
              </span>
            )}
          </div>
          <div className="truncate text-[11px] text-muted-foreground">
            {agent.role || (isPlatform ? "平台预设" : "AI 专属老师")}
          </div>
        </div>
      </div>
      <p className="mb-3 line-clamp-2 text-sm text-muted-foreground">
        {agent.tagline || "—"}
      </p>
      {agent.domains.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1">
          {agent.domains.slice(0, 4).map((d) => (
            <span
              key={d}
              className="rounded-full bg-secondary px-2 py-0.5 text-[10px] text-muted-foreground"
            >
              {d}
            </span>
          ))}
        </div>
      )}
      <div className="mt-auto flex items-center gap-2">
        <Button
          size="sm"
          onClick={onStart}
          disabled={busy}
          className="flex-1"
        >
          {busy ? (
            <>
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              打开中…
            </>
          ) : (
            <>
              <MessageSquare className="mr-1 h-3.5 w-3.5" />
              开始对话
            </>
          )}
        </Button>
        {!isPlatform && (
          <>
            {onTogglePublic && (
              <button
                type="button"
                onClick={onTogglePublic}
                className={cn(
                  "rounded-md border border-border p-1.5 transition hover:bg-secondary",
                  agent.is_public ? "text-emerald-600" : "text-muted-foreground",
                )}
                title={agent.is_public ? "已公开 · 点击转为私有" : "公开到发现页"}
              >
                {agent.is_public ? (
                  <Globe className="h-3.5 w-3.5" />
                ) : (
                  <Lock className="h-3.5 w-3.5" />
                )}
              </button>
            )}
            <Link
              href={`/agents/${agent.agent_key}/edit`}
              className="rounded-md border border-border p-1.5 text-muted-foreground transition hover:bg-secondary"
              title="编辑"
            >
              <Edit3 className="h-3.5 w-3.5" />
            </Link>
            {onDelete && (
              <button
                type="button"
                onClick={onDelete}
                className="rounded-md border border-border p-1.5 text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive"
                title="删除"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
