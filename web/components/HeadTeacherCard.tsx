"use client";

import { Compass, Loader2, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { AGENTS } from "@/lib/agents";

interface HeadTeacherCardProps {
  onEnter?: () => void;
  /** 当前驱动模型,例如 gpt-4o-mini */
  modelLabel?: string;
  /** 正在创建会话/跳转中,按钮显示 spinner 并禁用 */
  busy?: boolean;
}

export function HeadTeacherCard({
  onEnter,
  modelLabel,
  busy,
}: HeadTeacherCardProps) {
  const agent = AGENTS.head_teacher;
  return (
    <Card className="relative overflow-hidden border-border bg-foreground text-background shadow-card">
      <CardContent className="relative flex flex-col gap-6 p-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-background/15 bg-background/5 px-2.5 py-1 text-[11px] font-medium text-background/80">
            <Sparkles className="h-3 w-3" />
            <span>AI 学习教练 · {modelLabel || "gpt-4o-mini"}</span>
          </div>
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            {agent.displayName} {agent.emoji}
          </h2>
          <p className="max-w-xl text-sm/relaxed text-background/80">
            {agent.tagline}。和我聊聊这一周怎么安排,我帮你列清单、找重点、控节奏。
          </p>
        </div>
        <Button
          size="lg"
          className="self-start bg-background text-foreground hover:bg-background/90 sm:self-center"
          onClick={onEnter}
          disabled={busy}
        >
          {busy ? (
            <Loader2 className="mr-1 h-5 w-5 animate-spin" />
          ) : (
            <Compass className="mr-1 h-5 w-5" />
          )}
          {busy ? "正在打开对话…" : "找班主任规划一下"}
        </Button>
      </CardContent>
      <div
        aria-hidden
        className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-primary/25 blur-3xl"
      />
    </Card>
  );
}
