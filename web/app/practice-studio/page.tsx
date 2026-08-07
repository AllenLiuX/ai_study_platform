"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Clock,
  Loader2,
  Sparkles,
  Star,
  Trash2,
  Wand2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { practiceStudioApi } from "@/lib/api";
import type { PracticeSpecRecord } from "@/lib/types";
import { cn } from "@/lib/utils";

const EXAMPLES = [
  "给我 10 道高一函数图像的选择题，带即时讲解",
  "日语 N5 动词变位配对练习，附例句",
  "德州扑克翻牌圈决策训练，讲清底池赔率",
  "考研英语长难句分析，5 句填空 + 结构讲解",
  "Python 列表推导式 8 道由易到难的填空题",
  "初中物理浮力概念的判断题 + 计算题",
];

export default function PracticeStudioPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);

  const listQuery = useQuery({
    queryKey: ["practice-studios"],
    queryFn: practiceStudioApi.list,
    staleTime: 30_000,
  });

  const generate = useMutation({
    mutationFn: () =>
      practiceStudioApi.generate({ description: description.trim() }),
    onSuccess: (rec) => {
      queryClient.invalidateQueries({ queryKey: ["practice-studios"] });
      router.push(`/practice-studio/${rec.id}`);
    },
    onError: (err) =>
      setError(err instanceof Error ? err.message : "生成失败，请稍后再试"),
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

  function submit() {
    setError(null);
    if (description.trim().length < 4) {
      setError("请再具体描述一下你想练什么");
      return;
    }
    generate.mutate();
  }

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
            用一句话描述你想练什么，AI 现场为你生成一套可动手做、能即时判分的练习，并保存下来随时复用。
          </p>
        </header>

        {/* 生成区 */}
        <section className="rounded-3xl border border-border bg-card p-5 shadow-card">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="例如：给我 10 道高一函数单调性的选择题，每题带讲解"
            disabled={generate.isPending}
            className="w-full resize-y rounded-2xl border border-input bg-background px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <div className="mt-3 flex flex-wrap gap-1.5">
            {EXAMPLES.map((ex) => (
              <button
                key={ex}
                type="button"
                disabled={generate.isPending}
                onClick={() => setDescription(ex)}
                className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground transition hover:border-primary/40 hover:text-primary"
              >
                {ex}
              </button>
            ))}
          </div>
          {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
          <div className="mt-4 flex items-center justify-between">
            <span className="text-xs text-muted-foreground">
              约 10~30 秒生成
            </span>
            <Button onClick={submit} disabled={generate.isPending}>
              {generate.isPending ? (
                <>
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                  正在生成…
                </>
              ) : (
                <>
                  <Sparkles className="mr-1.5 h-4 w-4" />
                  生成练习
                </>
              )}
            </Button>
          </div>
        </section>

        {/* 我的练习 */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold tracking-tight text-muted-foreground">
            我的练习
          </h2>
          {listQuery.isLoading ? (
            <div className="h-24 animate-pulse rounded-2xl border border-border bg-card" />
          ) : records.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border bg-card/50 p-8 text-center text-sm text-muted-foreground">
              还没有练习。上面描述一下，生成你的第一套吧。
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
}: {
  rec: PracticeSpecRecord;
  onOpen: () => void;
  onDelete: () => void;
  onToggleFav: () => void;
}) {
  const blockCount = rec.spec?.blocks?.length ?? 0;
  return (
    <div className="group flex flex-col rounded-2xl border border-border bg-card p-4 shadow-card transition hover:border-primary/40">
      <div className="mb-1 flex items-start justify-between gap-2">
        <button
          type="button"
          onClick={onOpen}
          className="min-w-0 flex-1 text-left"
        >
          <h3 className="truncate text-sm font-semibold tracking-tight">
            {rec.title}
          </h3>
        </button>
        <button
          type="button"
          onClick={onToggleFav}
          className={cn(
            "shrink-0 rounded-full p-1 transition",
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
          <span>
            {rec.mode === "sandbox" ? "自定义界面" : `${blockCount} 个练习块`}
          </span>
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
