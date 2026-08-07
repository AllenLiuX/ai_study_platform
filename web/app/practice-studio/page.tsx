"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AppWindow,
  ArrowUpDown,
  Clock,
  GitBranch,
  Globe,
  Layers,
  ListChecks,
  Lock,
  type LucideIcon,
  SlidersHorizontal,
  Star,
  Timer,
  Trash2,
  Volume2,
  Wand2,
} from "lucide-react";
import { useRouter } from "next/navigation";

import { AppHeader } from "@/components/AppHeader";
import { TrainerComposer } from "@/components/practice-studio/TrainerComposer";
import { practiceStudioApi } from "@/lib/api";
import type { PracticeSpecRecord } from "@/lib/types";
import { cn } from "@/lib/utils";

// 训练器类型 → 展示用图标与标签
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
  return { label: "练习集", icon: ListChecks };
}

export default function PracticeStudioPage() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const listQuery = useQuery({
    queryKey: ["practice-studios"],
    queryFn: practiceStudioApi.list,
    staleTime: 30_000,
  });

  const remove = useMutation({
    mutationFn: (id: string) => practiceStudioApi.remove(id),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["practice-studios"] }),
  });

  const favorite = useMutation({
    mutationFn: ({ id, value }: { id: string; value: boolean }) =>
      practiceStudioApi.update(id, { is_favorite: value }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["practice-studios"] }),
  });

  const setPublic = useMutation({
    mutationFn: ({ id, value }: { id: string; value: boolean }) =>
      practiceStudioApi.update(id, { is_public: value }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["practice-studios"] }),
  });

  const records = listQuery.data ?? [];

  return (
    <div className="min-h-dvh bg-app-gradient">
      <AppHeader />
      <main className="container max-w-4xl space-y-8 py-6">
        <header className="space-y-1">
          <div className="flex items-center gap-2">
            <Wand2 className="h-5 w-5 text-primary" />
            <h1 className="text-2xl font-semibold tracking-tight">练习工坊</h1>
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
              Beta
            </span>
          </div>
          <p className="text-sm text-muted-foreground">
            描述你想练什么，AI 为你造一台<strong className="font-semibold text-foreground">交互式训练器</strong>——模拟器、计时训练、跟读、记忆卡、决策沙盘……一次生成，长期复用。
            <span className="ml-1 text-muted-foreground/80">（想刷题请用「练习」）</span>
          </p>
        </header>

        {/* 生成区：两步式（描述 → 规划确认 → 生成） */}
        <TrainerComposer
          onCreated={(rec) => {
            queryClient.invalidateQueries({ queryKey: ["practice-studios"] });
            router.push(`/practice-studio/${rec.id}`);
          }}
        />

        {/* 我的练习 */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold tracking-tight text-muted-foreground">
            我的训练器
          </h2>
          {listQuery.isLoading ? (
            <div className="h-24 animate-pulse rounded-2xl border border-border bg-card" />
          ) : records.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border bg-card/50 p-8 text-center text-sm text-muted-foreground">
              还没有训练器。上面描述一下，造出你的第一台吧。
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {records.map((rec) => (
                <RecordCard
                  key={rec.id}
                  rec={rec}
                  onOpen={() => router.push(`/practice-studio/${rec.id}`)}
                  onDelete={() => {
                    if (confirm(`删除「${rec.title}」？`)) remove.mutate(rec.id);
                  }}
                  onToggleFav={() =>
                    favorite.mutate({ id: rec.id, value: !rec.is_favorite })
                  }
                  onTogglePublic={() =>
                    setPublic.mutate({ id: rec.id, value: !rec.is_public })
                  }
                />
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

function RecordCard({
  rec,
  onOpen,
  onDelete,
  onToggleFav,
  onTogglePublic,
}: {
  rec: PracticeSpecRecord;
  onOpen: () => void;
  onDelete: () => void;
  onToggleFav: () => void;
  onTogglePublic: () => void;
}) {
  const meta = trainerMeta(rec);
  const TypeIcon = meta.icon;
  return (
    <div className="group flex flex-col rounded-2xl border border-border bg-card p-4 shadow-card transition hover:border-primary/40">
      <div className="mb-1 flex items-start justify-between gap-2">
        <button
          type="button"
          onClick={onOpen}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <TypeIcon className="h-4 w-4" />
          </span>
          <h3 className="truncate text-sm font-semibold tracking-tight">
            {rec.title}
          </h3>
        </button>
        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            onClick={onTogglePublic}
            className={cn(
              "rounded-full p-1 transition",
              rec.is_public
                ? "text-emerald-600"
                : "text-muted-foreground hover:text-emerald-600",
            )}
            title={rec.is_public ? "已公开 · 点击转为私有" : "公开到发现页"}
          >
            {rec.is_public ? (
              <Globe className="h-4 w-4" />
            ) : (
              <Lock className="h-4 w-4" />
            )}
          </button>
          <button
            type="button"
            onClick={onToggleFav}
            className={cn(
              "rounded-full p-1 transition",
              rec.is_favorite
                ? "text-amber-500"
                : "text-muted-foreground hover:text-amber-500",
            )}
            title={rec.is_favorite ? "取消收藏" : "收藏"}
          >
            <Star
              className="h-4 w-4"
              fill={rec.is_favorite ? "currentColor" : "none"}
            />
          </button>
        </div>
      </div>
      <button type="button" onClick={onOpen} className="flex-1 text-left">
        {rec.description && (
          <p className="line-clamp-2 text-xs text-muted-foreground">
            {rec.description}
          </p>
        )}
      </button>
      <div className="mt-3 flex items-center justify-between text-[11px] text-muted-foreground">
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-secondary px-2 py-0.5 font-medium text-secondary-foreground">
            {rec.domain || "通用"}
          </span>
          <span>{meta.label}</span>
          {rec.times_used > 0 && (
            <span className="flex items-center gap-0.5">
              <Clock className="h-3 w-3" />
              {rec.times_used}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onDelete}
          className="opacity-0 transition group-hover:opacity-100 hover:text-destructive"
          title="删除"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
