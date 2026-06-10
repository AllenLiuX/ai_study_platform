"use client";

import { Pencil, Sparkles } from "lucide-react";
import Link from "next/link";

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
            {profile.learner_type === "free_learner" ? (
              <Badge variant="default">自由学习者</Badge>
            ) : (
              <>
                {profile.grade && <Badge variant="default">{profile.grade}</Badge>}
                {profile.textbook_version && (
                  <Badge variant="secondary">{profile.textbook_version}</Badge>
                )}
                {profile.target_exam && (
                  <Badge variant="secondary">目标 · {profile.target_exam}</Badge>
                )}
              </>
            )}
            {(profile.focus_domains ?? []).slice(0, 4).map((d) => (
              <Badge key={d} variant="secondary">
                {d}
              </Badge>
            ))}
          </div>
          {profile.learning_goal && (
            <p className="max-w-xl text-sm text-muted-foreground">
              <span className="font-medium text-foreground">学习目标:</span>{" "}
              {profile.learning_goal}
            </p>
          )}
        </div>
        <div className="flex flex-col items-end gap-2">
          <Link
            href="/onboarding?edit=true"
            className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2.5 py-1 text-xs text-muted-foreground transition hover:border-primary/40 hover:text-primary"
            title="编辑昵称 / 学习者类型 / 重点科目 / 目标"
          >
            <Pencil className="h-3 w-3" />
            编辑资料
          </Link>
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
      </div>
    </section>
  );
}
