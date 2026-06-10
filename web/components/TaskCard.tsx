"use client";

import { ArrowRight, Clock, Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { DailyTask } from "@/lib/types";

interface TaskCardProps {
  task: DailyTask;
  /** AI 班主任分析的模型 (展示用) */
  modelLabel?: string;
  onClick?: () => void;
}

const TAG_VARIANT: Record<
  string,
  { label: string; className: string }
> = {
  薄弱: {
    label: "薄弱",
    className:
      "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-300",
  },
  复习: {
    label: "复习",
    className:
      "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-300",
  },
  新学: {
    label: "新学",
    className:
      "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-300",
  },
  规划: {
    label: "规划",
    className:
      "border-primary/30 bg-primary/10 text-primary dark:border-primary/40 dark:bg-primary/15",
  },
};

export function TaskCard({ task, modelLabel, onClick }: TaskCardProps) {
  const tagVariant = TAG_VARIANT[task.tag];
  return (
    <Card
      className="group relative cursor-pointer overflow-hidden transition hover:-translate-y-0.5 hover:shadow-card"
      onClick={onClick}
      role={onClick ? "button" : undefined}
      title={task.starter_prompt}
    >
      <span
        aria-hidden
        className="absolute inset-y-3 left-0 w-1 rounded-full bg-foreground/80 transition group-hover:bg-primary"
      />
      <CardContent className="space-y-3 pl-6 pt-6">
        <div className="flex items-center justify-between">
          <Badge variant="secondary">{task.subject_label}</Badge>
          {tagVariant ? (
            <span
              className={cn(
                "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium",
                tagVariant.className,
              )}
            >
              {tagVariant.label}
            </span>
          ) : (
            <Badge variant="outline">{task.tag}</Badge>
          )}
        </div>
        <h3 className="text-base font-semibold leading-snug">{task.title}</h3>
        <p className="line-clamp-2 text-sm text-muted-foreground">
          {task.description}
        </p>
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5" />
            预计 {task.estimated_minutes} 分钟
          </span>
          <span className="flex items-center gap-1 text-foreground/60 opacity-0 transition group-hover:opacity-100">
            一键开始
            <ArrowRight className="h-3.5 w-3.5" />
          </span>
        </div>
        {modelLabel && (
          <div className="flex items-center gap-1 pt-1 text-[10px] text-primary/70">
            <Sparkles className="h-2.5 w-2.5" />
            <span className="font-mono">{modelLabel}</span>
            <span>规划生成</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
