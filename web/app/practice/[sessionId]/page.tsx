"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Clock,
  Flag,
  GraduationCap,
  Lightbulb,
  Loader2,
  SkipForward,
  Sparkles,
  Target,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AppHeader } from "@/components/AppHeader";
import { MarkdownMessage } from "@/components/MarkdownMessage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { resolveAgentMeta } from "@/lib/agents";
import { chatApi, practiceApi } from "@/lib/api";
import { useAgents } from "@/lib/hooks/useAgents";
import type {
  AttemptResult,
  PracticeQuestion,
  PracticeSession,
} from "@/lib/types";
import { cn } from "@/lib/utils";

const KIND_LABEL: Record<string, string> = {
  mcq: "单选题",
  multi_mcq: "多选题",
  fill: "填空题",
  short: "简答题",
};

export default function PracticeSessionPage() {
  const params = useParams<{ sessionId: string }>();
  const sessionId = params.sessionId;
  const router = useRouter();
  const queryClient = useQueryClient();

  const sessionQuery = useQuery<PracticeSession>({
    queryKey: ["practice-session", sessionId],
    queryFn: () => practiceApi.get(sessionId),
    enabled: !!sessionId,
  });
  const session = sessionQuery.data;

  const agentsQuery = useAgents();
  const agentMeta = resolveAgentMeta(
    session?.agent_key ?? "head_teacher",
    agentsQuery.data ?? [],
  );

  // ---------------------------------------------------------------------------
  // 当前题 + 作答状态
  // ---------------------------------------------------------------------------
  const [question, setQuestion] = useState<PracticeQuestion | null>(null);
  const [result, setResult] = useState<AttemptResult | null>(null);
  const [isComplete, setIsComplete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 作答输入
  const [mcqChoice, setMcqChoice] = useState<string | null>(null);
  const [multiChoices, setMultiChoices] = useState<string[]>([]);
  const [fillText, setFillText] = useState("");
  const [shortText, setShortText] = useState("");

  // 提示
  const [hints, setHints] = useState<string[]>([]);

  // 计时
  const questionStartRef = useRef<number>(Date.now());
  const sessionStartRef = useRef<number>(Date.now());
  const [elapsedSec, setElapsedSec] = useState(0);

  useEffect(() => {
    const t = setInterval(
      () => setElapsedSec(Math.floor((Date.now() - sessionStartRef.current) / 1000)),
      1000,
    );
    return () => clearInterval(t);
  }, []);

  const resetAnswerState = useCallback(() => {
    setResult(null);
    setMcqChoice(null);
    setMultiChoices([]);
    setFillText("");
    setShortText("");
    setHints([]);
    questionStartRef.current = Date.now();
  }, []);

  // ---------------------------------------------------------------------------
  // 出题
  // ---------------------------------------------------------------------------
  const nextMutation = useMutation({
    mutationFn: () => practiceApi.nextQuestion(sessionId),
    onSuccess: (resp) => {
      if (resp.is_session_complete || !resp.question) {
        setIsComplete(true);
        setQuestion(null);
        return;
      }
      setQuestion(resp.question);
      resetAnswerState();
      setError(null);
    },
    onError: (err) =>
      setError(err instanceof Error ? err.message : "出题失败,请重试"),
  });

  // 首次进入自动拉题(若 session 还 active)
  const bootedRef = useRef(false);
  useEffect(() => {
    if (bootedRef.current) return;
    if (!session) return;
    if (session.status === "finished") {
      router.replace(`/practice/${sessionId}/summary`);
      return;
    }
    bootedRef.current = true;
    nextMutation.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, sessionId]);

  // ---------------------------------------------------------------------------
  // 提交 / 跳过
  // ---------------------------------------------------------------------------
  const currentAnswer = useMemo(() => {
    if (!question) return null;
    switch (question.kind) {
      case "mcq":
        return mcqChoice;
      case "multi_mcq":
        return multiChoices;
      case "fill":
        return fillText.trim();
      case "short":
        return shortText.trim();
      default:
        return null;
    }
  }, [question, mcqChoice, multiChoices, fillText, shortText]);

  const canSubmit = useMemo(() => {
    if (!question || result) return false;
    switch (question.kind) {
      case "mcq":
        return !!mcqChoice;
      case "multi_mcq":
        return multiChoices.length > 0;
      case "fill":
        return fillText.trim().length > 0;
      case "short":
        return shortText.trim().length > 1;
      default:
        return false;
    }
  }, [question, result, mcqChoice, multiChoices, fillText, shortText]);

  const submitMutation = useMutation({
    mutationFn: (opts: { skipped: boolean }) =>
      practiceApi.submitAttempt(question!.id, {
        user_answer: opts.skipped ? undefined : currentAnswer,
        skipped: opts.skipped,
        time_spent_ms: Date.now() - questionStartRef.current,
        hints_used: hints.length,
      }),
    onSuccess: (res, opts) => {
      setResult(res);
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["practice-session", sessionId] });
      // 跳过直接进下一题,不展示反馈
      if (opts.skipped) {
        nextMutation.mutate();
      }
    },
    onError: (err) =>
      setError(err instanceof Error ? err.message : "提交失败,请重试"),
  });

  // ---------------------------------------------------------------------------
  // 提示
  // ---------------------------------------------------------------------------
  const hintMutation = useMutation({
    mutationFn: () => practiceApi.hint(question!.id, hints.length + 1),
    onSuccess: (res) => setHints((prev) => [...prev, res.hint]),
    onError: (err) =>
      setError(err instanceof Error ? err.message : "获取提示失败"),
  });

  // ---------------------------------------------------------------------------
  // 请教老师:建 chat session 带题目跳转
  // ---------------------------------------------------------------------------
  const askTeacherMutation = useMutation({
    mutationFn: async () => {
      const chatSession = await chatApi.createSession({
        agent_type: session!.agent_key,
        title: `练习答疑:${session!.topic}`.slice(0, 60),
      });
      return chatSession;
    },
    onSuccess: (chatSession) => {
      const promptText = [
        `我在练习「${session?.topic}」时遇到一道${KIND_LABEL[question?.kind ?? "mcq"]},想请你引导我思考(先不要直接给答案):`,
        "",
        question?.prompt ?? "",
        question?.options?.length
          ? "\n选项:\n" +
            question.options.map((o) => `${o.id}. ${o.text}`).join("\n")
          : "",
      ]
        .join("\n")
        .trim();
      queryClient.invalidateQueries({ queryKey: ["chat-sessions"] });
      router.push(
        `/chat/${chatSession.id}?prompt=${encodeURIComponent(promptText)}`,
      );
    },
    onError: (err) =>
      setError(err instanceof Error ? err.message : "打开对话失败"),
  });

  // ---------------------------------------------------------------------------
  // 结束练习
  // ---------------------------------------------------------------------------
  const finishMutation = useMutation({
    mutationFn: () => practiceApi.finish(sessionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["practice-sessions"] });
      queryClient.invalidateQueries({ queryKey: ["practice-session", sessionId] });
      router.push(`/practice/${sessionId}/summary`);
    },
    onError: (err) =>
      setError(err instanceof Error ? err.message : "结束练习失败"),
  });

  // ---------------------------------------------------------------------------
  // 进度 + 超时提醒
  // ---------------------------------------------------------------------------
  const answeredCount = session?.answered_count ?? 0;
  const targetCount = session?.target_question_count ?? 10;
  const targetSec = (session?.target_minutes ?? 30) * 60;
  const overTime = elapsedSec > targetSec;

  function fmtTime(sec: number) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  if (sessionQuery.isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader />
        <main className="container max-w-3xl py-10">
          <div className="h-80 animate-pulse rounded-3xl bg-secondary/40" />
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
        {/* 顶栏:返回 + 进度 + 计时 + 结束 */}
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <Link
            href="/practice"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            练习列表
          </Link>
          <div className="flex items-center gap-4 text-sm">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <Target className="h-4 w-4" />
              {answeredCount} / {targetCount} 题
            </span>
            <span
              className={cn(
                "flex items-center gap-1.5",
                overTime ? "text-amber-600" : "text-muted-foreground",
              )}
            >
              <Clock className="h-4 w-4" />
              {fmtTime(elapsedSec)}
              {overTime ? " (超时)" : ` / ${session.target_minutes}:00`}
            </span>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              disabled={finishMutation.isPending}
              onClick={() => {
                const ok = window.confirm(
                  "确定结束这次练习吗?会生成复盘报告。",
                );
                if (ok) finishMutation.mutate();
              }}
            >
              {finishMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Flag className="h-3.5 w-3.5" />
              )}
              结束练习
            </Button>
          </div>
        </div>

        {/* 进度条 */}
        <div className="mb-6 h-1.5 overflow-hidden rounded-full bg-secondary">
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{
              width: `${Math.min(100, (answeredCount / targetCount) * 100)}%`,
            }}
          />
        </div>

        {/* 主题信息 */}
        <div className="mb-5 flex items-center gap-2 text-sm text-muted-foreground">
          <span className="text-lg">{agentMeta.emoji}</span>
          <span>{agentMeta.displayName}</span>
          <span>·</span>
          <span className="font-medium text-foreground">{session.topic}</span>
        </div>

        {/* 错误条 */}
        {error ? (
          <div className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        ) : null}

        {/* 完成态 */}
        {isComplete ? (
          <div className="rounded-3xl border border-border/60 bg-card p-10 text-center">
            <CheckCircle2 className="mx-auto mb-3 h-10 w-10 text-emerald-600" />
            <h2 className="text-xl font-semibold">已完成全部 {targetCount} 题!</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              点击下方按钮生成复盘报告,看看强弱知识点。
            </p>
            <Button
              size="lg"
              className="mt-6 gap-2"
              disabled={finishMutation.isPending}
              onClick={() => finishMutation.mutate()}
            >
              {finishMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> 正在生成复盘…
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" /> 生成复盘报告
                </>
              )}
            </Button>
          </div>
        ) : nextMutation.isPending && !question ? (
          <QuestionSkeleton text="老师正在出题…" />
        ) : question ? (
          <div className="rounded-3xl border border-border/60 bg-card p-6 sm:p-8">
            {/* 题头 */}
            <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded-full bg-primary/10 px-2.5 py-1 font-medium text-primary">
                第 {question.idx} 题 · {KIND_LABEL[question.kind]}
              </span>
              <span className="rounded-full bg-secondary px-2.5 py-1 text-muted-foreground">
                难度 {"★".repeat(question.difficulty)}
              </span>
              {question.knowledge_points.slice(0, 3).map((kp) => (
                <span
                  key={kp}
                  className="rounded-full border border-border/60 px-2.5 py-1 text-muted-foreground"
                >
                  {kp}
                </span>
              ))}
            </div>

            {/* 题干 */}
            <MarkdownMessage content={question.prompt} className="text-[15px]" />

            {/* 作答区 */}
            <div className="mt-6">
              {question.kind === "mcq" || question.kind === "multi_mcq" ? (
                <div className="space-y-2">
                  {(question.options ?? []).map((opt) => {
                    const selected =
                      question.kind === "mcq"
                        ? mcqChoice === opt.id
                        : multiChoices.includes(opt.id);
                    // 提交后给选项着色
                    let verdictClass = "";
                    if (result) {
                      const correctIds =
                        question.kind === "mcq"
                          ? [String(result.correct_answer)]
                          : ((result.correct_answer as string[]) ?? []);
                      if (correctIds.includes(opt.id)) {
                        verdictClass =
                          "border-emerald-500/60 bg-emerald-500/10";
                      } else if (selected) {
                        verdictClass = "border-destructive/60 bg-destructive/10";
                      }
                    }
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        disabled={!!result}
                        onClick={() => {
                          if (question.kind === "mcq") {
                            setMcqChoice(opt.id);
                          } else {
                            setMultiChoices((prev) =>
                              prev.includes(opt.id)
                                ? prev.filter((x) => x !== opt.id)
                                : [...prev, opt.id],
                            );
                          }
                        }}
                        className={cn(
                          "flex w-full items-start gap-3 rounded-xl border px-4 py-3 text-left text-sm transition",
                          verdictClass ||
                            (selected
                              ? "border-primary bg-primary/5"
                              : "border-border/60 hover:border-foreground/30 hover:bg-secondary/40"),
                          result && "cursor-default",
                        )}
                      >
                        <span
                          className={cn(
                            "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px] font-medium",
                            selected
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-border text-muted-foreground",
                          )}
                        >
                          {opt.id}
                        </span>
                        <MarkdownMessage
                          content={opt.text}
                          className="flex-1 text-sm [&_p]:my-0"
                        />
                      </button>
                    );
                  })}
                  {question.kind === "multi_mcq" && !result ? (
                    <p className="text-[11px] text-muted-foreground">
                      多选题:选出所有正确项。
                    </p>
                  ) : null}
                </div>
              ) : question.kind === "fill" ? (
                <Input
                  value={fillText}
                  disabled={!!result}
                  onChange={(e) => setFillText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && canSubmit) {
                      submitMutation.mutate({ skipped: false });
                    }
                  }}
                  placeholder="填写答案,回车提交"
                  className="max-w-md"
                />
              ) : (
                <Textarea
                  value={shortText}
                  disabled={!!result}
                  onChange={(e) => setShortText(e.target.value)}
                  placeholder="用自己的话回答(≤ 100 字),提交后 AI 老师按要点评分"
                  rows={4}
                  maxLength={500}
                  className="resize-none"
                />
              )}
            </div>

            {/* 提示区 */}
            {hints.length > 0 ? (
              <div className="mt-5 space-y-2">
                {hints.map((h, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 px-3 py-2.5 text-sm"
                  >
                    <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                    <MarkdownMessage content={h} className="flex-1 text-sm [&_p]:my-0" />
                  </div>
                ))}
              </div>
            ) : null}

            {/* 即时反馈 */}
            {result && !result.attempt.skipped ? (
              <FeedbackCard result={result} kind={question.kind} />
            ) : null}

            {/* 底部操作 */}
            <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-border/60 pt-5">
              {!result ? (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    disabled={hintMutation.isPending || hints.length >= 3}
                    onClick={() => hintMutation.mutate()}
                  >
                    {hintMutation.isPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Lightbulb className="h-3.5 w-3.5" />
                    )}
                    提示{hints.length > 0 ? ` (${hints.length}/3)` : ""}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    disabled={askTeacherMutation.isPending}
                    onClick={() => askTeacherMutation.mutate()}
                  >
                    {askTeacherMutation.isPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <GraduationCap className="h-3.5 w-3.5" />
                    )}
                    请教老师
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="gap-1.5 text-muted-foreground"
                    disabled={submitMutation.isPending}
                    onClick={() => submitMutation.mutate({ skipped: true })}
                  >
                    <SkipForward className="h-3.5 w-3.5" />
                    跳过
                  </Button>
                  <div className="flex-1" />
                  <Button
                    disabled={!canSubmit || submitMutation.isPending}
                    onClick={() => submitMutation.mutate({ skipped: false })}
                    className="gap-1.5"
                  >
                    {submitMutation.isPending ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        {question.kind === "short" ? "AI 评分中…" : "判定中…"}
                      </>
                    ) : (
                      "提交"
                    )}
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    disabled={askTeacherMutation.isPending}
                    onClick={() => askTeacherMutation.mutate()}
                  >
                    {askTeacherMutation.isPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <GraduationCap className="h-3.5 w-3.5" />
                    )}
                    和老师讨论这题
                  </Button>
                  <div className="flex-1" />
                  <Button
                    disabled={nextMutation.isPending}
                    onClick={() => nextMutation.mutate()}
                    className="gap-1.5"
                  >
                    {nextMutation.isPending ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" /> 出题中…
                      </>
                    ) : (
                      <>
                        下一题 <ArrowRight className="h-4 w-4" />
                      </>
                    )}
                  </Button>
                </>
              )}
            </div>
          </div>
        ) : (
          <QuestionSkeleton text="加载中…" />
        )}

        {/* 学习计划 (折叠在题卡下方) */}
        {session.plan ? (
          <details className="mt-6 rounded-2xl border border-border/60 bg-secondary/20 px-5 py-4">
            <summary className="cursor-pointer text-sm font-medium text-muted-foreground">
              本次练习计划(老师生成)
            </summary>
            <div className="mt-3">
              <MarkdownMessage content={session.plan} className="text-sm" />
            </div>
          </details>
        ) : null}
      </main>
    </div>
  );
}

// -----------------------------------------------------------------------------
// 即时反馈卡
// -----------------------------------------------------------------------------
function FeedbackCard({
  result,
  kind,
}: {
  result: AttemptResult;
  kind: string;
}) {
  const a = result.attempt;
  const isShort = kind === "short";
  const correct = a.is_correct === true;

  const correctAnswerText = useMemo(() => {
    const ca = result.correct_answer;
    if (ca == null) return "";
    if (typeof ca === "string") return ca;
    if (Array.isArray(ca)) return ca.map(String).join(" / ");
    if (typeof ca === "object") {
      const obj = ca as Record<string, unknown>;
      return String(obj.reference ?? obj.rubric ?? JSON.stringify(ca));
    }
    return String(ca);
  }, [result.correct_answer]);

  return (
    <div
      className={cn(
        "mt-5 rounded-2xl border p-4",
        correct
          ? "border-emerald-500/40 bg-emerald-500/5"
          : "border-destructive/40 bg-destructive/5",
      )}
    >
      <div className="flex items-center gap-2">
        {correct ? (
          <CheckCircle2 className="h-5 w-5 text-emerald-600" />
        ) : (
          <XCircle className="h-5 w-5 text-destructive" />
        )}
        <span className="font-medium">
          {isShort && a.score != null
            ? `${correct ? "通过" : "待加强"} · AI 评分 ${a.score}/10`
            : correct
              ? "回答正确!"
              : "回答错误"}
        </span>
      </div>

      {/* 简答评语 */}
      {a.feedback ? (
        <div className="mt-3 rounded-xl bg-background/60 px-3 py-2.5">
          <MarkdownMessage content={a.feedback} className="text-sm" />
        </div>
      ) : null}

      {/* 标准答案 */}
      {correctAnswerText ? (
        <div className="mt-3 text-sm">
          <span className="font-medium text-muted-foreground">
            {isShort ? "参考答案:" : "正确答案:"}
          </span>
          <MarkdownMessage
            content={correctAnswerText}
            className="mt-1 text-sm"
          />
        </div>
      ) : null}

      {/* 解析 */}
      {result.explanation ? (
        <div className="mt-3 border-t border-border/40 pt-3 text-sm">
          <span className="font-medium text-muted-foreground">解析:</span>
          <MarkdownMessage
            content={result.explanation}
            className="mt-1 text-sm"
          />
        </div>
      ) : null}
    </div>
  );
}

function QuestionSkeleton({ text }: { text: string }) {
  return (
    <div className="rounded-3xl border border-border/60 bg-card p-10 text-center">
      <Loader2 className="mx-auto mb-3 h-8 w-8 animate-spin text-primary" />
      <p className="text-sm text-muted-foreground">{text}</p>
    </div>
  );
}
