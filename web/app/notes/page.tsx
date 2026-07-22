"use client";

// Phase 7: useSearchParams 需要 client 侧渲染, 禁用预生成
export const dynamic = "force-dynamic";

import { Suspense } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronRight,
  Filter,
  Loader2,
  Notebook,
  Plus,
  Search,
  Sparkles,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";

import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { resolveAgentMeta } from "@/lib/agents";
import { groupsApi, notesApi } from "@/lib/api";
import { useAgents } from "@/lib/hooks/useAgents";
import type { KnowledgeNote } from "@/lib/types";
import { cn } from "@/lib/utils";

type Scope = "personal" | "group" | "all";

export default function NotesPage() {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-muted-foreground">加载中…</div>}>
      <NotesPageInner />
    </Suspense>
  );
}

function NotesPageInner() {
  const router = useRouter();
  const search = useSearchParams();
  const urlScope = (search?.get("scope") ?? "personal") as Scope;
  const urlGroupId = search?.get("group_id") ?? null;
  const scope: Scope =
    urlScope === "group" && urlGroupId ? "group" : urlScope === "all" ? "all" : "personal";

  const [q, setQ] = useState("");
  const [agentFilter, setAgentFilter] = useState<string | null>(null);
  const [tagFilter, setTagFilter] = useState<string | null>(null);

  const myGroupsQuery = useQuery({
    queryKey: ["my-groups"],
    queryFn: groupsApi.mine,
    staleTime: 60_000,
  });
  const currentGroup = useMemo(
    () =>
      scope === "group" && urlGroupId
        ? (myGroupsQuery.data ?? []).find((g) => g.id === urlGroupId)
        : null,
    [scope, urlGroupId, myGroupsQuery.data],
  );

  const setScope = (next: Scope, groupId?: string) => {
    const params = new URLSearchParams();
    if (next === "group" && groupId) {
      params.set("scope", "group");
      params.set("group_id", groupId);
    } else if (next === "all") {
      params.set("scope", "all");
    }
    const qs = params.toString();
    router.replace(qs ? `/notes?${qs}` : "/notes");
  };

  const notesQuery = useQuery<KnowledgeNote[]>({
    queryKey: ["notes", scope, urlGroupId, { agentFilter, tagFilter }],
    queryFn: () =>
      notesApi.list({
        agent_key: agentFilter ?? undefined,
        tag: tagFilter ?? undefined,
        scope: scope === "personal" ? undefined : scope,
        group_id: scope === "group" && urlGroupId ? urlGroupId : undefined,
      }),
    refetchInterval: (q) => {
      const list = (q.state.data as KnowledgeNote[] | undefined) ?? [];
      const cooking = list.some(
        (n) => n.chunk_status === "pending" || n.chunk_status === "processing",
      );
      return cooking ? 3000 : false;
    },
  });

  const agentsQuery = useAgents();

  const all = notesQuery.data ?? [];
  const filtered = useMemo(() => {
    if (!q.trim()) return all;
    const needle = q.toLowerCase();
    return all.filter(
      (n) =>
        n.title.toLowerCase().includes(needle) ||
        (n.summary ?? "").toLowerCase().includes(needle) ||
        n.tags.some((t) => t.toLowerCase().includes(needle)),
    );
  }, [all, q]);

  const tagCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const n of all) {
      for (const t of n.tags) {
        m.set(t, (m.get(t) ?? 0) + 1);
      }
    }
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]).slice(0, 16);
  }, [all]);

  const agentCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const n of all) {
      if (!n.agent_key) continue;
      m.set(n.agent_key, (m.get(n.agent_key) ?? 0) + 1);
    }
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [all]);

  return (
    <div className="min-h-screen bg-app-gradient">
      <AppHeader />
      <div className="container py-8">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="mb-1 inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
              <Notebook className="h-3.5 w-3.5" />
              知识点笔记
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {scope === "group" && currentGroup
                ? `${currentGroup.emoji || "👥"} ${currentGroup.name} · 共享笔记`
                : "我的知识点 · 笔记"}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {scope === "group" && currentGroup ? (
                <>
                  这是「{currentGroup.name}」群里所有成员共享的笔记。
                  <Link
                    href={`/groups/${currentGroup.id}`}
                    className="ml-1 text-primary hover:underline"
                  >
                    返回群主页 →
                  </Link>
                </>
              ) : (
                <>
                  对话中沉淀下来的可复用知识点。每条笔记都参与 RAG —
                  下次对话时,老师会自动召回相关知识点作为参考。
                </>
              )}
            </p>
          </div>
          <Link href={`/notes/new${scope === "group" && urlGroupId ? `?group_id=${urlGroupId}` : ""}`}>
            <Button size="lg" variant="outline">
              <Plus className="mr-1 h-4 w-4" />
              手动新建
            </Button>
          </Link>
        </div>

        {/* Phase 7: scope 切换 */}
        <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
          <button
            type="button"
            onClick={() => setScope("personal")}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 transition",
              scope === "personal"
                ? "border-primary/40 bg-primary/10 text-primary"
                : "border-border bg-card text-muted-foreground hover:border-primary/30 hover:text-foreground",
            )}
          >
            个人
          </button>
          {(myGroupsQuery.data ?? []).map((g) => (
            <button
              key={g.id}
              type="button"
              onClick={() => setScope("group", g.id)}
              className={cn(
                "inline-flex max-w-[220px] items-center gap-1.5 rounded-full border px-3 py-1 transition",
                scope === "group" && urlGroupId === g.id
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-border bg-card text-muted-foreground hover:border-primary/30 hover:text-foreground",
              )}
            >
              <span>{g.emoji || "👥"}</span>
              <span className="truncate font-medium">{g.name}</span>
            </button>
          ))}
          {(myGroupsQuery.data?.length ?? 0) > 0 && (
            <button
              type="button"
              onClick={() => setScope("all")}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 transition",
                scope === "all"
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-border bg-card text-muted-foreground hover:border-primary/30 hover:text-foreground",
              )}
            >
              <Users className="h-3 w-3" />
              全部
            </button>
          )}
        </div>

        <div className="mb-4 flex flex-wrap gap-2">
          <div className="relative max-w-sm flex-1">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="搜索标题 / 摘要 / 标签"
              className="pl-9"
            />
          </div>
          {(agentFilter || tagFilter) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setAgentFilter(null);
                setTagFilter(null);
              }}
            >
              清除筛选
            </Button>
          )}
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
          <aside className="space-y-4">
            <FilterGroup title="按老师">
              {agentCounts.length === 0 ? (
                <p className="text-xs text-muted-foreground">还没有笔记</p>
              ) : (
                agentCounts.map(([key, count]) => {
                  const meta = resolveAgentMeta(key, agentsQuery.data);
                  const active = agentFilter === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setAgentFilter(active ? null : key)}
                      className={cn(
                        "flex w-full items-center justify-between rounded-md px-2 py-1 text-xs transition",
                        active
                          ? "bg-primary/10 text-primary"
                          : "text-muted-foreground hover:bg-secondary",
                      )}
                    >
                      <span className="flex items-center gap-1.5 truncate">
                        <span>{meta.emoji}</span>
                        <span className="truncate">{meta.displayName}</span>
                      </span>
                      <span>{count}</span>
                    </button>
                  );
                })
              )}
            </FilterGroup>
            <FilterGroup title="按标签">
              {tagCounts.length === 0 ? (
                <p className="text-xs text-muted-foreground">暂无标签</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {tagCounts.map(([t, count]) => {
                    const active = tagFilter === t;
                    return (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setTagFilter(active ? null : t)}
                        className={cn(
                          "rounded-full border px-2 py-0.5 text-[10px] transition",
                          active
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border text-muted-foreground hover:border-primary/40",
                        )}
                      >
                        {t} · {count}
                      </button>
                    );
                  })}
                </div>
              )}
            </FilterGroup>
          </aside>

          <section>
            {notesQuery.isLoading ? (
              <div className="space-y-3">
                {[0, 1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-24 rounded-2xl" />
                ))}
              </div>
            ) : filtered.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border bg-card/40 p-10 text-center">
                <Sparkles className="mx-auto mb-2 h-7 w-7 text-muted-foreground" />
                <h3 className="text-base font-semibold">还没有任何笔记</h3>
                <p className="mt-1 max-w-md mx-auto text-sm text-muted-foreground">
                  在和 AI 老师讨论某个知识点时,点击老师回答下的「保存为笔记」,
                  AI 会自动蒸馏成结构化的 markdown 知识点;下次再聊这块时也会自动召回参考。
                </p>
              </div>
            ) : (
              <ul className="space-y-2.5">
                {filtered.map((n) => (
                  <NoteRow key={n.id} note={n} agentsData={agentsQuery.data} />
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function FilterGroup({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        <Filter className="h-3 w-3" />
        {title}
      </div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function NoteRow({
  note,
  agentsData,
}: {
  note: KnowledgeNote;
  agentsData: ReturnType<typeof useAgents>["data"];
}) {
  const meta = note.agent_key
    ? resolveAgentMeta(note.agent_key, agentsData)
    : null;
  return (
    <Link
      href={`/notes/${note.id}`}
      className="group flex items-start gap-3 rounded-2xl border border-border bg-card p-3.5 shadow-card transition hover:border-primary/40"
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-foreground text-base text-background">
        {meta?.emoji ?? "📝"}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-1.5">
          <h3 className="truncate text-sm font-semibold">{note.title}</h3>
          <StatusPill status={note.chunk_status} />
        </div>
        {note.summary && (
          <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">
            {note.summary}
          </p>
        )}
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
          {meta && <span>{meta.displayName}</span>}
          {meta && note.tags.length > 0 && <span className="opacity-50">·</span>}
          {note.tags.slice(0, 4).map((t) => (
            <span key={t} className="rounded-full bg-secondary px-1.5 py-0.5">
              {t}
            </span>
          ))}
          <span className="ml-auto">掌握 {note.mastery_score}%</span>
        </div>
      </div>
      <ChevronRight className="mt-2 h-4 w-4 text-muted-foreground transition group-hover:translate-x-0.5" />
    </Link>
  );
}

function StatusPill({
  status,
}: {
  status: KnowledgeNote["chunk_status"];
}) {
  if (status === "ready") return null;
  if (status === "pending" || status === "processing") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-accent px-1.5 py-0.5 text-[9px] text-accent-foreground">
        <Loader2 className="h-2.5 w-2.5 animate-spin" />
        切片中
      </span>
    );
  }
  return (
    <span className="rounded-full bg-destructive/10 px-1.5 py-0.5 text-[9px] text-destructive">
      切片失败
    </span>
  );
}
