"use client";

import { Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { AgentMeta } from "@/lib/agents";
import type { StudentProfile } from "@/lib/types";

interface StudentProfilePanelProps {
  profile: StudentProfile | null;
  agent: AgentMeta;
  modelLabel?: string;
}

export function StudentProfilePanel({
  profile,
  agent,
  modelLabel,
}: StudentProfilePanelProps) {
  return (
    <aside className="hidden h-full w-80 shrink-0 overflow-y-auto border-l border-border/60 bg-background/60 px-5 py-6 scrollbar-thin lg:block">
      <div className="space-y-6">
        <section>
          <div className="mb-3 flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-foreground text-lg text-background">
              {agent.emoji}
            </span>
            <div className="min-w-0">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                当前老师
              </div>
              <div className="truncate font-semibold">{agent.displayName}</div>
            </div>
          </div>
          <p className="text-sm text-muted-foreground">{agent.tagline}</p>
          {modelLabel && (
            <div className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-primary/15 bg-primary/5 px-2.5 py-1 text-[11px] font-medium text-primary">
              <Sparkles className="h-3 w-3" />
              {modelLabel}
            </div>
          )}
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold">学生画像</h3>
          <Card>
            <CardContent className="space-y-2.5 p-4 text-sm">
              <Row label="昵称" value={profile?.name} />
              <Row label="年级" value={profile?.grade} />
              <Row label="教材" value={profile?.textbook_version} />
              <Row label="目标" value={profile?.target_exam} />
              {profile?.focus_subjects && profile.focus_subjects.length > 0 && (
                <div className="flex items-start justify-between gap-2">
                  <span className="text-muted-foreground">重点科目</span>
                  <div className="flex flex-wrap justify-end gap-1">
                    {profile.focus_subjects.map((s) => (
                      <Badge key={s} variant="secondary">
                        {s}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
              {profile?.learning_goal && (
                <div className="pt-2 border-t border-border/50">
                  <div className="text-xs text-muted-foreground">学习目标</div>
                  <p className="mt-1 text-foreground">{profile.learning_goal}</p>
                </div>
              )}
            </CardContent>
          </Card>
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold">学习进度</h3>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">即将在 Phase 2 接入</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 pt-0 text-xs text-muted-foreground">
              <p>
                等你和老师多聊几次,系统会自动总结你的:
              </p>
              <ul className="list-disc space-y-1 pl-4">
                <li>当前章节</li>
                <li>掌握度</li>
                <li>高频薄弱知识点</li>
                <li>推荐的下一步任务</li>
              </ul>
            </CardContent>
          </Card>
        </section>
      </div>
    </aside>
  );
}

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="truncate font-medium">{value || "—"}</span>
    </div>
  );
}
