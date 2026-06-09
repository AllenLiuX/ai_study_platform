"use client";

import { Clock } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

export interface TaskCardData {
  title: string;
  description: string;
  subject: string;
  estimatedMinutes: number;
  /** 任务类型徽章 */
  tag?: "必做" | "薄弱" | "复习" | "新任务";
}

export function TaskCard({
  task,
  onClick,
}: {
  task: TaskCardData;
  onClick?: () => void;
}) {
  return (
    <Card
      className="group relative cursor-pointer overflow-hidden transition hover:-translate-y-0.5 hover:shadow-card"
      onClick={onClick}
      role={onClick ? "button" : undefined}
    >
      <span
        aria-hidden
        className="absolute inset-y-3 left-0 w-1 rounded-full bg-foreground/80 transition group-hover:bg-primary"
      />
      <CardContent className="space-y-3 pl-6 pt-6">
        <div className="flex items-center justify-between">
          <Badge variant="secondary">{task.subject}</Badge>
          {task.tag && <Badge variant="outline">{task.tag}</Badge>}
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
