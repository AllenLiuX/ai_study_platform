"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Map, Sparkles, Target } from "lucide-react";
import Link from "next/link";

import { roadmapsApi } from "@/lib/api";

/**
 * 驾驶舱上的「学习规划」亮点卡。
 * - 有进行中的规划 → 展示标题 / 目标 / 完成度 / 当前正在学的节点。
 * - 没有规划 → 引导用户去 /roadmap 生成第一份。
 */
export function RoadmapHighlightCard() {
  const { data, isLoading } = useQuery({
    queryKey: ["roadmaps"],
    queryFn: roadmapsApi.list,
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <div className="h-36 animate-pulse rounded-3xl border border-border bg-card" />
    );
  }

  const roadmaps = data ?? [];
  const active = roadmaps.find((r) => r.status === "active") ?? roadmaps[0] ?? null;

  if (!active) {
    return (
      <Link
        href="/roadmap"
        className="group flex flex-col justify-between gap-4 rounded-3xl border border-dashed border-border bg-card/50 p-6 transition hover:border-primary/40 sm:flex-row sm:items-center"
      >
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Map className="h-5 w-5" />
          </span>
          <div>
            <h3 className="text-base font-semibold tracking-tight">
              制定你的专属学习规划
            </h3>
            <p className="mt-1 max-w-xl text-sm text-muted-foreground">
              把「学好某个方向」拆成清晰的学习路线，每一步都有明确目标和阶段成果。
            </p>
          </div>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1 self-start rounded-full bg-primary px-3.5 py-1.5 text-sm font-medium text-primary-foreground sm:self-auto">
          <Sparkles className="h-3.5 w-3.5" />
          生成规划
        </span>
      </Link>
    );
  }

  const nodes = active.lanes.flatMap((lane) => lane.nodes);
  const done = nodes.filter((n) => n.status === "done").length;
  const current = nodes.find((n) => n.status === "current");
  const progress = nodes.length ? Math.round((done / nodes.length) * 100) : 0;

  return (
    <Link
      href="/roadmap"
      className="group block rounded-3xl border border-border bg-card p-6 shadow-card transition hover:border-primary/40"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Map className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <div className="text-xs font-medium text-primary">继续你的学习规划</div>
            <h3 className="truncate text-base font-semibold tracking-tight">
              {active.title}
            </h3>
            <p className="mt-0.5 line-clamp-1 text-sm text-muted-foreground">
              {active.goal}
            </p>
          </div>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1 text-sm text-primary">
          查看
          <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" />
        </span>
      </div>

      <div className="mt-4 space-y-2">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {active.lanes.length} 条学习线 · 完成 {done}/{nodes.length}
          </span>
          <span className="font-medium text-foreground">{progress}%</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-secondary">
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {current && (
        <div className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Target className="h-3.5 w-3.5 text-primary" />
          正在学：<span className="text-foreground">{current.title}</span>
        </div>
      )}
    </Link>
  );
}
