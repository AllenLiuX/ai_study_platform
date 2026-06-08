"use client";

import { Clock } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export interface TaskCardData {
  title: string;
  description: string;
  subject: string;
  estimatedMinutes: number;
  /** 用于左侧色带 */
  accent?: "primary" | "amber" | "emerald" | "rose";
  tag?: "必做" | "薄弱" | "复习" | "新任务";
}

const accentMap: Record<NonNullable<TaskCardData["accent"]>, string> = {
  primary: "bg-indigo-500",
  amber: "bg-amber-500",
  emerald: "bg-emerald-500",
  rose: "bg-rose-500",
};

export function TaskCard({
  task,
  onClick,
}: {
  task: TaskCardData;
  onClick?: () => void;
}) {
  return (
    <Card
      className="relative cursor-pointer overflow-hidden transition hover:-translate-y-0.5 hover:shadow-lg"
      onClick={onClick}
      role={onClick ? "button" : undefined}
    >
      <span
        className={cn(
          "absolute inset-y-3 left-0 w-1.5 rounded-full",
          accentMap[task.accent ?? "primary"],
        )}
      />
      <CardContent className="space-y-3 pl-6 pt-6">
        <div className="flex items-center justify-between">
          <Badge variant="secondary">{task.subject}</Badge>
          {task.tag && <Badge variant="accent">{task.tag}</Badge>}
        </div>
        <h3 className="text-base font-semibold leading-snug">{task.title}</h3>
        <p className="line-clamp-2 text-sm text-muted-foreground">
          {task.description}
        </p>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Clock className="h-3.5 w-3.5" />
          <span>预计 {task.estimatedMinutes} 分钟</span>
        </div>
      </CardContent>
    </Card>
  );
}
