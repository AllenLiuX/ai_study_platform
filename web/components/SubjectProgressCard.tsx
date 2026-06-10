"use client";

import { ArrowRight, Loader2, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import type { AgentMeta } from "@/lib/agents";
import type { SubjectProgress, WeakPoint } from "@/lib/types";

interface SubjectProgressCardProps {
  agent: AgentMeta;
  progress?: SubjectProgress;
  /** 触发抽取的模型,展示在卡片底部 */
  modelLabel?: string;
  onEnter?: () => void;
  /** 正在创建会话/跳转中,按钮显示 spinner 并禁用 */
  busy?: boolean;
}

export function SubjectProgressCard({
  agent,
  progress,
  modelLabel,
  onEnter,
  busy,
}: SubjectProgressCardProps) {
  const covered = progress?.covered_count ?? 0;
  const hasData = covered > 0;
  const mastery = hasData ? Math.round(progress!.avg_mastery) : 50;
  const currentChapter =
    progress?.current_chapter ?? "暂未开始,等你和老师聊起来";
  const weakPoints: WeakPoint[] = (progress?.weak_points ?? []).filter(
    (p) => p.encounter_count > 0,
  );

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
        <Button variant="ghost" size="sm" onClick={onEnter} disabled={busy}>
          {busy ? (
            <>
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              打开中
            </>
          ) : (
            <>
              找老师
              <ArrowRight className="ml-1 h-4 w-4" />
            </>
          )}
        </Button>
      </div>
      <CardContent className="space-y-3 pt-5">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">
          最近章节
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
          <Progress value={mastery} />
          {hasData && (
            <div className="text-[10px] text-muted-foreground">
              已涉及 {covered} 个知识点 · {progress?.weak_count ?? 0} 个待巩固
            </div>
          )}
        </div>

        <div className="text-xs text-muted-foreground">
          {weakPoints.length > 0 ? (
            <>
              <span className="text-foreground">薄弱点:</span>{" "}
              {weakPoints.map((p) => p.name).join("、")}
            </>
          ) : (
            <span>多和老师聊几次,AI 会自动总结你的薄弱点</span>
          )}
        </div>

        {modelLabel && hasData && (
          <div className="flex items-center gap-1 pt-1 text-[10px] text-primary/70">
            <Sparkles className="h-2.5 w-2.5" />
            <span className="font-mono">{modelLabel}</span>
            <span>分析对话生成</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
