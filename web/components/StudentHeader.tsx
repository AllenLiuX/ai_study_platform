"use client";

import { Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { StudentProfile } from "@/lib/types";

interface StudentHeaderProps {
  profile: StudentProfile;
  /** 当前 AI 栈,例如 "gpt-4o-mini · text-embedding-3-small" */
  modelStack?: string;
}

function timeBasedGreeting(): string {
  const h = new Date().getHours();
  if (h < 6) return "夜深了,早点休息";
  if (h < 12) return "早上好";
  if (h < 14) return "中午好";
  if (h < 18) return "下午好";
  if (h < 23) return "晚上好";
  return "夜深了,早点休息";
}

export function StudentHeader({ profile, modelStack }: StudentHeaderProps) {
  const greeting = timeBasedGreeting();
  return (
    <section className="rounded-3xl border border-border bg-card p-6 shadow-card sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>{greeting},很高兴又见到你</span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            {profile.name || "同学"},准备好今天的学习了吗?
          </h1>
          <div className="flex flex-wrap items-center gap-2">
            {profile.grade && <Badge variant="default">{profile.grade}</Badge>}
            {profile.textbook_version && (
              <Badge variant="secondary">{profile.textbook_version}</Badge>
            )}
            {profile.target_exam && (
              <Badge variant="secondary">目标 · {profile.target_exam}</Badge>
            )}
          </div>
          {profile.learning_goal && (
            <p className="max-w-xl text-sm text-muted-foreground">
              <span className="font-medium text-foreground">学习目标:</span>{" "}
              {profile.learning_goal}
            </p>
          )}
        </div>
        {modelStack && (
          <div className="rounded-2xl border border-primary/15 bg-primary/5 px-3 py-2 text-xs">
            <div className="flex items-center gap-1.5 font-medium text-primary">
              <Sparkles className="h-3.5 w-3.5" />
              AI 学习栈
            </div>
            <div className="mt-0.5 text-muted-foreground">{modelStack}</div>
          </div>
        )}
      </div>
    </section>
  );
}
