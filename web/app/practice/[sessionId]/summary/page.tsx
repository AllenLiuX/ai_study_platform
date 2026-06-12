"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  Lightbulb,
  Loader2,
  Notebook,
  Plus,
  SkipForward,
  Target,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { AppHeader } from "@/components/AppHeader";
import { MarkdownMessage } from "@/components/MarkdownMessage";
import { Button } from "@/components/ui/button";
import { resolveAgentMeta } from "@/lib/agents";
import { notesApi, practiceApi } from "@/lib/api";
import { useAgents } from "@/lib/hooks/useAgents";
import type { PracticeQuestion, PracticeSession } from "@/lib/types";
import { cn } from "@/lib/utils";

const KIND_LABEL: Record<string, string> = {
  mcq: "单选",
  multi_mcq: "多选",
  fill: "填空",
  short: "简答",
};

interface KpStat {
  correct: number;
  wrong: number;
}

export default function PracticeSummaryPage() {
  const params = useParams<{ sessionId: string }>();
  const sessionId = params.sessionId;
  const router = useRouter();
  const queryClient = useQueryClient();
  const [noteError, setNoteError] = useState<string | null>(null);

  const sessionQuery = useQuery<PracticeSession>({
    queryKey: ["practice-session", sessionId],
    queryFn: () => practiceApi.get(sessionId),
    enabled: !!sessionId,
  });
  const session = sessionQuery.data;

  const questionsQuery = useQuery<PracticeQuestion[]>({
    queryKey: ["practice-questions", sessionId],
    queryFn: () => practiceApi.listQuestions(sessionId),
    enabled: !!sessionId,
  });

  const agentsQuery = useAgents();
  const agentMeta = resolveAgentMeta(
    session?.agent_key ?? "head_teacher",
    agentsQuery.data ?? [],
  );

  const summary = (session?.summary ?? {}) as Record<string, unknown>;
  const summaryMarkdown = String(summary.markdown ?? "");
  const kpStats = (summary.kp_stats ?? {}) as Record<string, KpStat>;

  const stats = useMemo(() => {
    const answered = Number(summary.answered ?? session?.answered_count ?? 0);
    const correct = Number(summary.correct ?? session?.correct_count ?? 0);
    const total = Number(summary.total_questions ?? session?.question_count ?? 0);
    const accuracy = answered > 0 ? Math.round((correct / answered) * 100) : 0;
    return { answered, correct, wrong: answered - correct, total, accuracy };
  }, [summary, session]);

  const kpRows = useMemo(() => {
    return Object.entries(kpStats)
      .map(([kp, s]) => {
        const total = s.correct + s.wrong;
        return {
          kp,
          ...s,
          total,
          rate: total > 0 ? Math.round((s.correct / total) * 100) : 0,
        };
      })
      .sort((a, b) => a.rate - b.rate); // 弱的排前面
  }, [kpStats]);

  const weakest = kpRows.filter((r) => r.rate < 60).map((r) => r.kp);

  const noteMutation = useMutation({
    mutationFn: () =>
      notesApi.createFromPractice({ practice_session_id: sessionId }),
    onSuccess: (note) => {
      queryClient.invalidateQueries({ queryKey: ["notes"] });
      router.push(`/notes/${note.id}`);
    },
    onError: (err) =>
      setNoteError(err instanceof Error ? err.message : "整理笔记失败"),
  });

  if (sessionQuery.isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader />
        <main className="container max-w-3xl py-10">
          <div className="h-96 animate-pulse rounded-3xl bg-secondary/40" />
        </main>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader />
        <main className="container max-w-3xl py-20 text-center">
          <p className="text-muted-foreground">练习不存在或已被删除。</p>
          <Link href="/practice" className="mt-4 inline-block">
            <Button variant="outline">返回练习列表</Button>
          </Link>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="container max-w-3xl py-8">
        <Link
          href="/practice"
          className="mb-5 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          练习列表
        </Link>

        {/* 头部 */}
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="mb-1 flex items-center gap-2 text-sm text-muted-foreground">
              <span className="text-lg">{agentMeta.emoji}</span>
              <span>{agentMeta.displayName}</span>
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {session.topic} · 复盘
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              className="gap-1.5"
              disabled={noteMutation.isPending}
              onClick={() => {
                setNoteError(null);
                noteMutation.mutate();
              }}
            >
              {noteMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  AI 整理中…
                </>
              ) : (
                <>
                  <Notebook className="h-4 w-4" />
                  整理为笔记
                </>
              )}
            </Button>
            <Link
              href={`/practice/new?agent=${encodeURIComponent(session.agent_key)}&topic=${encodeURIComponent(
                weakest.length > 0 ? weakest.slice(0, 2).join("、") : session.topic,
              )}`}
            >
              <Button className="gap-1.5">
                <Plus className="h-4 w-4" />
                {weakest.length > 0 ? "针对薄弱点再练" : "再练一组"}
              </Button>
            </Link>
          </div>
        </div>

        {noteError ? (
          <div className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {noteError}
          </div>
        ) : null}

        {/* 统计卡 */}
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="答题数" value={`${stats.answered}`} sub={`共出 ${stats.total} 题`} />
          <StatCard
            label="正确率"
            value={`${stats.accuracy}%`}
            sub={`对 ${stats.correct} / 错 ${stats.wrong}`}
            highlight={stats.accuracy >= 80 ? "good" : stats.accuracy < 50 ? "bad" : undefined}
          />
          <StatCard
            label="用时"
            value={
              session.finished_at && session.started_at
                ? fmtDuration(
                    new Date(session.finished_at).getTime() -
                      new Date(session.started_at).getTime(),
                  )
                : "-"
            }
            sub={`目标 ${session.target_minutes} 分钟`}
          />
          <StatCard
            label="知识点"
            value={`${kpRows.length}`}
            sub={weakest.length > 0 ? `${weakest.length} 个待加强` : "全部达标"}
          />
        </div>

        {/* 知识点掌握度 */}
        {kpRows.length > 0 ? (
          <section className="mb-6 rounded-3xl border border-border/60 bg-card p-6">
            <h2 className="mb-4 flex items-center gap-2 text-base font-semibold">
              <Target className="h-4 w-4 text-primary" />
              知识点掌握度
            </h2>
            <ul className="space-y-3">
              {kpRows.map((r) => (
                <li key={r.kp}>
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <span className="font-medium">{r.kp}</span>
                    <span
                      className={cn(
                        "text-xs",
                        r.rate >= 80
                          ? "text-emerald-600"
                          : r.rate < 60
                            ? "text-destructive"
                            : "text-muted-foreground",
                      )}
                    >
                      {r.correct}/{r.total} · {r.rate}%
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-secondary">
                    <div
                      className={cn(
                        "h-full rounded-full transition-all",
                        r.rate >= 80
                          ? "bg-emerald-500"
                          : r.rate < 60
                            ? "bg-destructive"
                            : "bg-amber-500",
                      )}
                      style={{ width: `${Math.max(4, r.rate)}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {/* LLM 复盘 markdown */}
        {summaryMarkdown ? (
          <section className="mb-6 rounded-3xl border border-border/60 bg-card p-6">
            <h2 className="mb-3 flex items-center gap-2 text-base font-semibold">
              <Lightbulb className="h-4 w-4 text-amber-600" />
              老师复盘
            </h2>
            <MarkdownMessage content={summaryMarkdown} className="text-sm" />
          </section>
        ) : null}

        {/* 逐题回顾 */}
        <section className="rounded-3xl border border-border/60 bg-card p-6">
          <h2 className="mb-4 text-base font-semibold">逐题回顾</h2>
          {questionsQuery.isLoading ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 加载中…
            </div>
          ) : (
            <ul className="space-y-2">
              {(questionsQuery.data ?? []).map((q) => (
                <QuestionReviewItem key={q.id} question={q} />
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
  highlight,
}: {
  label: string;
  value: string;
  sub?: string;
  highlight?: "good" | "bad";
}) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={cn(
          "mt-1 text-2xl font-semibold tracking-tight",
          highlight === "good" && "text-emerald-600",
          highlight === "bad" && "text-destructive",
        )}
      >
        {value}
      </div>
      {sub ? (
        <div className="mt-0.5 text-[11px] text-muted-foreground">{sub}</div>
      ) : null}
    </div>
  );
}

function QuestionReviewItem({ question }: { question: PracticeQuestion }) {
  const [open, setOpen] = useState(false);
  const a = question.attempt;

  let icon = <SkipForward className="h-4 w-4 text-muted-foreground" />;
  let verdictText = "未答";
  if (a?.skipped) {
    verdictText = "跳过";
  } else if (a?.is_correct === true) {
    icon = <CheckCircle2 className="h-4 w-4 text-emerald-600" />;
    verdictText = a.score != null ? `评分 ${a.score}/10` : "正确";
  } else if (a?.is_correct === false) {
    icon = <XCircle className="h-4 w-4 text-destructive" />;
    verdictText = a.score != null ? `评分 ${a.score}/10` : "错误";
  }

  const correctAnswerText = useMemo(() => {
    const ca = question.correct_answer;
    if (ca == null) return "";
    if (typeof ca === "string") return ca;
    if (Array.isArray(ca)) return ca.map(String).join(" / ");
    if (typeof ca === "object") {
      const obj = ca as Record<string, unknown>;
      return String(obj.reference ?? obj.rubric ?? "");
    }
    return String(ca);
  }, [question.correct_answer]);

  return (
    <li className="rounded-2xl border border-border/60">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm transition hover:bg-secondary/40"
      >
        {icon}
        <span className="w-10 shrink-0 text-xs text-muted-foreground">
          #{question.idx}
        </span>
        <span className="min-w-0 flex-1 truncate">{question.prompt}</span>
        <span className="shrink-0 text-xs text-muted-foreground">
          {KIND_LABEL[question.kind]} · {verdictText}
        </span>
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
      </button>
      {open ? (
        <div className="border-t border-border/40 px-4 py-4">
          <MarkdownMessage content={question.prompt} className="text-sm" />
          {question.options?.length ? (
            <ul className="mt-3 space-y-1 text-sm">
              {question.options.map((o) => (
                <li key={o.id} className="flex gap-2">
                  <span className="font-medium text-muted-foreground">{o.id}.</span>
                  <span>{o.text}</span>
                </li>
              ))}
            </ul>
          ) : null}
          {a && !a.skipped && a.user_answer != null ? (
            <p className="mt-3 text-sm">
              <span className="font-medium text-muted-foreground">你的答案:</span>{" "}
              {Array.isArray(a.user_answer)
                ? a.user_answer.join(", ")
                : String(a.user_answer)}
            </p>
          ) : null}
          {correctAnswerText ? (
            <p className="mt-1.5 text-sm">
              <span className="font-medium text-muted-foreground">参考答案:</span>{" "}
              {correctAnswerText}
            </p>
          ) : null}
          {a?.feedback ? (
            <div className="mt-3 rounded-xl bg-secondary/40 px-3 py-2.5">
              <MarkdownMessage content={a.feedback} className="text-sm" />
            </div>
          ) : null}
          {question.explanation ? (
            <div className="mt-3 border-t border-border/40 pt-3">
              <span className="text-sm font-medium text-muted-foreground">解析:</span>
              <MarkdownMessage
                content={question.explanation}
                className="mt-1 text-sm"
              />
            </div>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function fmtDuration(ms: number) {
  const min = Math.round(ms / 60000);
  if (min < 1) return "<1 分钟";
  if (min < 60) return `${min} 分钟`;
  return `${Math.floor(min / 60)} 小时 ${min % 60} 分`;
}
