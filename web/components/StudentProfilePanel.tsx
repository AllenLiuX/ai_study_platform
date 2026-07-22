"use client";

import {
  ArrowRight,
  BookOpen,
  MessageCircle,
  Notebook,
  Sparkles,
  Target,
  UserRound,
} from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { AgentMeta } from "@/lib/agents";
import type {
  ChatSession,
  StudentProfile,
  SubjectProgress,
} from "@/lib/types";
import { cn } from "@/lib/utils";

interface StudentProfilePanelProps {
  profile: StudentProfile | null;
  agent: AgentMeta;
  modelLabel?: string;
  /** 该用户所有会话 (用于统计累计对话数) */
  sessions?: ChatSession[];
  /** 该用户已收藏笔记数 */
  notesCount?: number | null;
  /** dashboard 里各科掌握度 (可选,来自 studentApi.getDashboard) */
  progress?: SubjectProgress[];
  /**
   * 外层容器 className。默认桌面端 `hidden lg:block` 右侧栏样式;
   * 手机抽屉里传入自定义 className (无 hidden) 即可直接展示。
   */
  className?: string;
}

const DEFAULT_DESKTOP_CLASSNAME =
  "hidden h-full w-80 shrink-0 overflow-y-auto border-l border-border/60 bg-background/60 px-5 py-6 scrollbar-thin lg:block";

function formatRelativeTime(iso?: string | null): string | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  const diff = Date.now() - t;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "刚刚";
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day} 天前`;
  const mon = Math.floor(day / 30);
  return `${mon} 个月前`;
}

export function StudentProfilePanel({
  profile,
  agent,
  modelLabel,
  sessions,
  notesCount,
  progress,
  className,
}: StudentProfilePanelProps) {
  // 学生画像 — 只显示有值的行,避免大量「—」占位
  const rows: { label: string; value: string | null | undefined; icon?: React.ReactNode }[] = [
    { label: "昵称", value: profile?.name },
    { label: "年级", value: profile?.grade },
    { label: "教材", value: profile?.textbook_version },
    { label: "目标", value: profile?.target_exam },
  ];
  const filledRows = rows.filter((r) => r.value && String(r.value).trim());
  const filledCount = filledRows.length;
  const totalCount = rows.length;
  const needsOnboarding = filledCount <= 1 && !profile?.learning_goal;

  // 学习进度统计
  const sessionsCount = sessions?.length ?? 0;
  const now = Date.now();
  const sessionsThisWeek =
    sessions?.filter((s) => {
      const t = s.created_at ? new Date(s.created_at).getTime() : NaN;
      return !Number.isNaN(t) && now - t < 7 * 24 * 60 * 60 * 1000;
    }).length ?? 0;
  const lastSessionRel = formatRelativeTime(sessions?.[0]?.created_at);

  // 掌握度只取前 2 个非零的科目
  const topProgress = (progress ?? [])
    .filter((p) => p.covered_count > 0 || p.avg_mastery > 0)
    .slice(0, 2);

  const hasAnyActivity =
    sessionsCount > 0 || (notesCount ?? 0) > 0 || topProgress.length > 0;

  return (
    <aside className={cn(className ?? DEFAULT_DESKTOP_CLASSNAME)}>
      <div className="space-y-6">
        {/* 当前老师 */}
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

        {/* 学生画像 */}
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">学生画像</h3>
            {filledCount > 0 && (
              <span className="text-[11px] text-muted-foreground">
                {filledCount}/{totalCount}
              </span>
            )}
          </div>
          <Card>
            <CardContent className="space-y-2.5 p-4 text-sm">
              {needsOnboarding ? (
                <div className="space-y-3 py-1">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <UserRound className="h-4 w-4" />
                    <span className="text-sm">画像还很空</span>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    补全年级、教材、目标后,老师能给出更贴合你阶段的讲解和例题。
                  </p>
                  <Link
                    href="/onboarding"
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
                  >
                    去补全 <ArrowRight className="h-3 w-3" />
                  </Link>
                </div>
              ) : (
                <>
                  {filledRows.map((r) => (
                    <div
                      key={r.label}
                      className="flex items-center justify-between gap-2"
                    >
                      <span className="text-muted-foreground">{r.label}</span>
                      <span className="truncate font-medium">{r.value}</span>
                    </div>
                  ))}
                  {profile?.focus_subjects &&
                    profile.focus_subjects.length > 0 && (
                      <div className="flex items-start justify-between gap-2">
                        <span className="shrink-0 text-muted-foreground">
                          重点科目
                        </span>
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
                    <div className="border-t border-border/50 pt-2">
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Target className="h-3 w-3" />
                        学习目标
                      </div>
                      <p className="mt-1 text-foreground">
                        {profile.learning_goal}
                      </p>
                    </div>
                  )}
                  {filledCount < totalCount && (
                    <Link
                      href="/onboarding"
                      className="inline-flex items-center gap-1 pt-1 text-[11px] text-muted-foreground transition hover:text-primary"
                    >
                      继续补全 ({totalCount - filledCount} 项待填)
                      <ArrowRight className="h-3 w-3" />
                    </Link>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </section>

        {/* 学习进度 */}
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">学习进度</h3>
          <Card>
            <CardContent className="space-y-3 p-4">
              {hasAnyActivity ? (
                <>
                  {/* 三个 stat pill */}
                  <div className="grid grid-cols-2 gap-2">
                    <StatCell
                      icon={<MessageCircle className="h-3.5 w-3.5" />}
                      label="累计对话"
                      value={sessionsCount}
                      hint={
                        sessionsThisWeek > 0
                          ? `近 7 天 ${sessionsThisWeek} 条`
                          : lastSessionRel
                            ? `最近 ${lastSessionRel}`
                            : undefined
                      }
                    />
                    <StatCell
                      icon={<Notebook className="h-3.5 w-3.5" />}
                      label="笔记"
                      value={notesCount ?? 0}
                      hint={notesCount === null ? "加载中…" : undefined}
                    />
                  </div>

                  {/* 科目掌握度 */}
                  {topProgress.length > 0 && (
                    <div className="space-y-2 border-t border-border/50 pt-3">
                      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                        <BookOpen className="h-3 w-3" />
                        掌握度
                      </div>
                      {topProgress.map((p) => (
                        <ProgressRow key={p.subject_id} progress={p} />
                      ))}
                    </div>
                  )}

                  <Link
                    href="/dashboard"
                    className="inline-flex items-center gap-1 pt-1 text-[11px] text-muted-foreground transition hover:text-primary"
                  >
                    看驾驶舱详情 <ArrowRight className="h-3 w-3" />
                  </Link>
                </>
              ) : (
                <div className="space-y-2 text-sm">
                  <p className="text-muted-foreground">
                    还没有学习记录。多聊几次、录几堂听课、做几组练习,这里会自动
                    汇总你的对话数、笔记数、各科掌握度。
                  </p>
                  <Link
                    href="/dashboard"
                    className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                  >
                    去驾驶舱看今日任务 <ArrowRight className="h-3 w-3" />
                  </Link>
                </div>
              )}
            </CardContent>
          </Card>
        </section>
      </div>
    </aside>
  );
}

function StatCell({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-background/60 px-2.5 py-2">
      <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="text-lg font-semibold tabular-nums leading-tight">
        {value}
      </div>
      {hint && (
        <div className="mt-0.5 truncate text-[10px] text-muted-foreground">
          {hint}
        </div>
      )}
    </div>
  );
}

function ProgressRow({ progress }: { progress: SubjectProgress }) {
  const pct = Math.max(0, Math.min(100, Math.round(progress.avg_mastery * 100)));
  const barColor =
    pct >= 70 ? "bg-emerald-500" : pct >= 40 ? "bg-amber-500" : "bg-rose-500";
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="truncate font-medium">{progress.subject_name}</span>
        <span className="shrink-0 tabular-nums text-muted-foreground">
          {pct}%
          {progress.weak_count > 0 && (
            <span className="ml-1 text-rose-500">· {progress.weak_count} 弱</span>
          )}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-border/60">
        <div
          className={cn("h-full rounded-full transition-all", barColor)}
          style={{ width: `${pct}%` }}
        />
      </div>
      {progress.current_chapter && (
        <div className="truncate text-[10px] text-muted-foreground">
          当前:{progress.current_chapter}
        </div>
      )}
    </div>
  );
}
