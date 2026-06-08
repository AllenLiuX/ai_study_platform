"use client";

import { ArrowRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import type { AgentMeta } from "@/lib/agents";
import { cn } from "@/lib/utils";

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
    <Card className="overflow-hidden transition hover:-translate-y-0.5 hover:shadow-lg">
      <div
        className={cn(
          "flex items-center justify-between bg-gradient-to-br px-5 py-4 text-white",
          agent.gradient,
        )}
      >
        <div className="flex items-center gap-3">
          <span className="text-2xl">{agent.emoji}</span>
          <div>
            <div className="text-sm opacity-80">{agent.subjectId}</div>
            <div className="text-lg font-semibold">{agent.displayName}</div>
          </div>
        </div>
        <Button
          variant="secondary"
          size="sm"
          className="border-white/20 bg-white/15 text-white hover:bg-white/25"
          onClick={onEnter}
        >
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
            <span>{hasData ? `${mastery}%` : "待评估"}</span>
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
