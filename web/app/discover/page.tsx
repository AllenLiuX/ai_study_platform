"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AppWindow,
  ArrowUpDown,
  Check,
  Compass,
  GitBranch,
  GraduationCap,
  Layers,
  Loader2,
  type LucideIcon,
  MessageSquare,
  Play,
  Search,
  SlidersHorizontal,
  Sparkles,
  Star,
  Timer,
  UserPlus,
  Volume2,
  Wand2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { agentsApi, chatApi, practiceStudioApi } from "@/lib/api";
import type {
  ChatMessage,
  ChatSession,
  PracticeSpecRecord,
  UserAgent,
} from "@/lib/types";
import { cn } from "@/lib/utils";

type Tab = "agents" | "trainers";

const TRAINER_META: Record<string, { label: string; icon: LucideIcon }> = {
  simulator: { label: "参数模拟器", icon: SlidersHorizontal },
  timed_drill: { label: "计时训练", icon: Timer },
  audio_trainer: { label: "音频跟读", icon: Volume2 },
  flashcards_srs: { label: "记忆卡", icon: Layers },
  drag_order: { label: "拖拽构造", icon: ArrowUpDown },
  decision_tree: { label: "决策沙盘", icon: GitBranch },
};

function trainerMeta(rec: PracticeSpecRecord): { label: string; icon: LucideIcon } {
  const spec = rec.spec as { kind?: string; template_id?: string } | null;
  if (spec?.kind === "template" && spec.template_id && TRAINER_META[spec.template_id]) {
    return TRAINER_META[spec.template_id];
  }
  if (spec?.kind === "app" || rec.mode === "app") {
    return { label: "定制应用", icon: AppWindow };
  }
  return { label: "练习集", icon: Wand2 };
}

export default function DiscoverPage() {
  const [tab, setTab] = useState<Tab>("agents");
  const [input, setInput] = useState("");
  const [q, setQ] = useState("");
  const [flash, setFlash] = useState<string | null>(null);

  function submitSearch() {
    setQ(input.trim());
  }

  return (
    <div className="min-h-dvh bg-app-gradient">
      <AppHeader />
      <main className="container max-w-5xl space-y-6 py-6">
        <header className="space-y-1">
          <div className="flex items-center gap-2">
            <Compass className="h-5 w-5 text-primary" />
            <h1 className="text-2xl font-semibold tracking-tight">发现</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            用别人分享的老师和训练器 —— 找一位对口的老师直接开课，或挑一台训练器上手练。
          </p>
        </header>

        {/* Tabs */}
        <div className="flex items-center gap-1 rounded-full border border-border bg-card p-1 text-sm w-fit">
          <TabButton active={tab === "agents"} onClick={() => setTab("agents")}>
            <GraduationCap className="mr-1.5 h-4 w-4" />
            老师
          </TabButton>
          <TabButton active={tab === "trainers"} onClick={() => setTab("trainers")}>
            <Wand2 className="mr-1.5 h-4 w-4" />
            训练器
          </TabButton>
        </div>

        {/* Search */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submitSearch()}
              placeholder={
                tab === "agents"
                  ? "搜索老师：量化、日语、面试、带货…"
                  : "搜索训练器：模拟器、口算、跟读…"
              }
              className="h-11 w-full rounded-xl border border-input bg-background pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <Button onClick={submitSearch} variant="secondary">
            搜索
          </Button>
        </div>

        {flash && (
          <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            <Check className="h-4 w-4" />
            {flash}
          </div>
        )}

        {tab === "agents" ? (
          <AgentsTab q={q} onFlash={setFlash} />
        ) : (
          <TrainersTab q={q} onFlash={setFlash} />
        )}
      </main>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center rounded-full px-4 py-1.5 font-medium transition",
        active
          ? "bg-primary text-primary-foreground"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

// -----------------------------------------------------------------------------
// 老师 tab
// -----------------------------------------------------------------------------
function AgentsTab({ q, onFlash }: { q: string; onFlash: (m: string) => void }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ["public-agents", q],
    queryFn: () => agentsApi.listPublic(q || undefined),
    staleTime: 30_000,
  });

  const addToMine = useMutation({
    mutationFn: (sourceId: string) => agentsApi.clone(sourceId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agents"] });
      onFlash("已添加到「我的老师」");
    },
    onError: (err) =>
      onFlash(err instanceof Error ? err.message : "添加失败，请稍后再试"),
  });

  async function startWith(agent: UserAgent) {
    if (busyId) return;
    setBusyId(agent.id);
    try {
      const mine = await agentsApi.clone(agent.id); // 克隆到自己名下(已存在则复用)
      queryClient.invalidateQueries({ queryKey: ["agents"] });
      const session = await chatApi.createSession({
        agent_type: mine.agent_key,
        subject_id: mine.subject_id ?? null,
      });
      queryClient.setQueryData<ChatSession[]>(["chat-sessions"], (prev) => {
        const list = prev ? [...prev] : [];
        return [session, ...list.filter((s) => s.id !== session.id)];
      });
      queryClient.setQueryData<ChatMessage[]>(["chat-messages", session.id], []);
      router.push(`/chat/${session.id}`);
    } catch (err) {
      setBusyId(null);
      onFlash(err instanceof Error ? err.message : "无法开始对话");
    }
  }

  const list = query.data ?? [];

  if (query.isLoading) return <GridSkeleton />;
  if (list.length === 0)
    return (
      <Empty text={q ? "没有匹配的老师，换个关键词试试。" : "还没有公开的老师。"} />
    );

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {list.map((a) => (
        <div
          key={a.id}
          className="flex flex-col rounded-2xl border border-border bg-card p-4 shadow-card transition hover:border-primary/40"
        >
          <div className="mb-3 flex items-start gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-foreground text-2xl text-background">
              {a.emoji || "🎓"}
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="truncate text-base font-semibold">{a.display_name}</h3>
              <div className="truncate text-[11px] text-muted-foreground">
                {a.role || "AI 专属老师"}
              </div>
            </div>
          </div>
          <p className="mb-3 line-clamp-2 text-sm text-muted-foreground">
            {a.tagline || "—"}
          </p>
          {a.domains.length > 0 && (
            <div className="mb-3 flex flex-wrap gap-1">
              {a.domains.slice(0, 4).map((d) => (
                <span
                  key={d}
                  className="rounded-full bg-secondary px-2 py-0.5 text-[10px] text-muted-foreground"
                >
                  {d}
                </span>
              ))}
            </div>
          )}
          <div className="mb-3 flex items-center gap-2 text-[11px] text-muted-foreground">
            <span>by {a.author_name || "匿名同学"}</span>
            {(a.clone_count ?? 0) > 0 && <span>· {a.clone_count} 人采用</span>}
          </div>
          <div className="mt-auto flex items-center gap-2">
            <Button
              size="sm"
              className="flex-1"
              disabled={busyId === a.id}
              onClick={() => startWith(a)}
            >
              {busyId === a.id ? (
                <>
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                  准备中…
                </>
              ) : (
                <>
                  <MessageSquare className="mr-1 h-3.5 w-3.5" />
                  用ta上课
                </>
              )}
            </Button>
            <button
              type="button"
              onClick={() => addToMine.mutate(a.id)}
              disabled={addToMine.isPending}
              title="添加到我的老师"
              className="rounded-md border border-border p-1.5 text-muted-foreground transition hover:bg-secondary"
            >
              <UserPlus className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

// -----------------------------------------------------------------------------
// 训练器 tab
// -----------------------------------------------------------------------------
function TrainersTab({ q, onFlash }: { q: string; onFlash: (m: string) => void }) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["public-trainers", q],
    queryFn: () => practiceStudioApi.listPublic(q || undefined),
    staleTime: 30_000,
  });

  const save = useMutation({
    mutationFn: (sourceId: string) => practiceStudioApi.clone(sourceId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["practice-studios"] });
      onFlash("已收藏到「我的工坊」");
    },
    onError: (err) =>
      onFlash(err instanceof Error ? err.message : "收藏失败，请稍后再试"),
  });

  const list = query.data ?? [];

  if (query.isLoading) return <GridSkeleton />;
  if (list.length === 0)
    return (
      <Empty text={q ? "没有匹配的训练器，换个关键词试试。" : "还没有公开的训练器。"} />
    );

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {list.map((rec) => {
        const meta = trainerMeta(rec);
        const Icon = meta.icon;
        return (
          <div
            key={rec.id}
            className="flex flex-col rounded-2xl border border-border bg-card p-4 shadow-card transition hover:border-primary/40"
          >
            <div className="mb-2 flex items-start gap-2">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Icon className="h-4 w-4" />
              </span>
              <h3 className="min-w-0 flex-1 text-sm font-semibold tracking-tight">
                {rec.title}
              </h3>
            </div>
            {rec.description && (
              <p className="mb-3 line-clamp-2 text-xs text-muted-foreground">
                {rec.description}
              </p>
            )}
            <div className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
              <span className="rounded-full bg-secondary px-2 py-0.5 font-medium text-secondary-foreground">
                {rec.domain || "通用"}
              </span>
              <span>{meta.label}</span>
              <span>· by {rec.author_name || "匿名同学"}</span>
              {rec.times_used > 0 && <span>· 练过 {rec.times_used} 次</span>}
            </div>
            <div className="mt-auto flex items-center gap-2">
              <Button
                size="sm"
                className="flex-1"
                onClick={() => router.push(`/practice-studio/${rec.id}`)}
              >
                <Play className="mr-1 h-3.5 w-3.5" />
                开始训练
              </Button>
              <button
                type="button"
                onClick={() => save.mutate(rec.id)}
                disabled={save.isPending}
                title="收藏到我的工坊"
                className="rounded-md border border-border p-1.5 text-muted-foreground transition hover:bg-secondary"
              >
                <Star className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function GridSkeleton() {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div
          key={i}
          className="h-40 animate-pulse rounded-2xl border border-border bg-card"
        />
      ))}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-card/50 p-10 text-center text-sm text-muted-foreground">
      <Sparkles className="mx-auto mb-2 h-6 w-6" />
      {text}
    </div>
  );
}
