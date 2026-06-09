"use client";

import { ArrowRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import type { AgentMeta } from "@/lib/agents";

interface SubjectProgressCardProps {
  agent: AgentMeta;
  /** 当前章节,Phase 0 用 placeholder 文案 */
  currentChapter?: string;
  /** 掌握度 0-100 */
  mastery?: number;
  /** 薄弱知识点 */
  weakPoints?: string[];
  onEnter?: () => void;
}

export function SubjectProgressCard({
  agent,
  currentChapter = "暂未开始,等你和老师聊起来",
  mastery,
  weakPoints = [],
  onEnter,
}: SubjectProgressCardProps) {
  const hasData = typeof mastery === "number";

  return (
    <Card className="group overflow-hidden transition hover:-translate-y-0.5 hover:shadow-card">
      <div className="flex items-center justify-between border-b border-border bg-secondary/60 px-5 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-foreground text-lg text-background">
            {agent.emoji}
          </span>
          <div className="min-w-0">
            <div className="truncate text-xs uppercase tracking-wide text-muted-foreground">
              {agent.role}
            </div>
            <div className="truncate text-base font-semibold">
              {agent.displayName}
            </div>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={onEnter}>
          找老师
          <ArrowRight className="ml-1 h-4 w-4" />
        </Button>
      </div>
      <CardContent className="space-y-3 pt-5">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">
          当前
        </div>
        <div className="text-sm font-medium text-foreground">
          {currentChapter}
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>掌握度</span>
            <span className="font-medium text-foreground">
              {hasData ? `${mastery}%` : "待评估"}
            </span>
          </div>
          <Progress value={hasData ? mastery! : 0} />
        </div>

        <div className="text-xs text-muted-foreground">
          {weakPoints.length > 0 ? (
            <>
              <span className="text-foreground">薄弱点:</span>{" "}
              {weakPoints.join("、")}
            </>
          ) : (
            <span>薄弱点会在多次对话后自动总结(Phase 2)</span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
