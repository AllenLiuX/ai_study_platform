"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  Brain,
  Clock,
  GraduationCap,
  Loader2,
  Sparkles,
  Target,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";

import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { metaApi, practiceApi } from "@/lib/api";
import { useAgents } from "@/lib/hooks/useAgents";
import type {
  ModelTierId,
  PracticeDifficultyStrategy,
  PracticeQuestionKind,
} from "@/lib/types";
import { cn } from "@/lib/utils";

const KIND_OPTIONS: { id: PracticeQuestionKind; label: string; desc: string }[] = [
  { id: "mcq", label: "选择", desc: "4 选 1,即时判定" },
  { id: "multi_mcq", label: "多选", desc: "2-3 个正确选项" },
  { id: "fill", label: "填空", desc: "短答案 + 语义判定" },
  { id: "short", label: "简答", desc: "100 字内,LLM 评分" },
];

const DIFFICULTY_OPTIONS: { id: PracticeDifficultyStrategy; label: string }[] = [
  { id: "adaptive", label: "自适应(推荐)" },
  { id: "fixed_1", label: "1 入门" },
  { id: "fixed_2", label: "2 简单" },
  { id: "fixed_3", label: "3 中等" },
  { id: "fixed_4", label: "4 困难" },
  { id: "fixed_5", label: "5 很难" },
];

const MINUTE_OPTIONS = [10, 20, 30, 45, 60];
const COUNT_OPTIONS = [5, 10, 15, 20];

export default function NewPracticePage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <NewPracticeInner />
    </Suspense>
  );
}

function PageSkeleton() {
  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="container py-10">
        <div className="h-96 animate-pulse rounded-3xl bg-secondary/40" />
      </main>
    </div>
  );
}

function NewPracticeInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialAgent = searchParams.get("agent") ?? "";
  const initialTopic = searchParams.get("topic") ?? "";

  const [agentKey, setAgentKey] = useState<string>(initialAgent);
  const [topic, setTopic] = useState<string>(initialTopic);
  const [targetMinutes, setTargetMinutes] = useState<number>(30);
  const [targetCount, setTargetCount] = useState<number>(10);
  const [difficulty, setDifficulty] =
    useState<PracticeDifficultyStrategy>("adaptive");
  const [allowedKinds, setAllowedKinds] = useState<PracticeQuestionKind[]>([
    "mcq",
    "fill",
    "short",
  ]);
  const [modelTier, setModelTier] = useState<ModelTierId>("medium");
  const [error, setError] = useState<string | null>(null);

  const agentsQuery = useAgents();
  const configQuery = useQuery({
    queryKey: ["meta-config"],
    queryFn: metaApi.config,
    staleTime: 5 * 60_000,
  });
  const tiers = configQuery.data?.model_tiers ?? [];
  const defaultTier = configQuery.data?.default_tier ?? "medium";

  // 默认 tier 跟服务端走
  useEffect(() => {
    if (configQuery.data && !configQuery.isLoading) {
      setModelTier(defaultTier);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configQuery.data]);

  const agents = agentsQuery.data ?? [];
  const selectedAgent = useMemo(
    () => agents.find((a) => a.agent_key === agentKey),
    [agents, agentKey],
  );

  // 默认选第一个 agent
  useEffect(() => {
    if (!agentKey && agents.length > 0) {
      setAgentKey(agents[0].agent_key);
    }
  }, [agents, agentKey]);

  const createMutation = useMutation({
    mutationFn: () =>
      practiceApi.create({
        agent_key: agentKey,
        topic: topic.trim(),
        target_minutes: targetMinutes,
        target_question_count: targetCount,
        difficulty_strategy: difficulty,
        allowed_kinds: allowedKinds,
        model_tier: modelTier,
      }),
    onSuccess: (s) => {
      router.replace(`/practice/${s.id}`);
    },
    onError: (err) =>
      setError(err instanceof Error ? err.message : "创建失败"),
  });

  const canSubmit =
    !createMutation.isPending &&
    !!agentKey &&
    topic.trim().length > 1 &&
    allowedKinds.length > 0;

  function toggleKind(k: PracticeQuestionKind) {
    setAllowedKinds((prev) =>
      prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k],
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="container max-w-4xl py-10">
        <Link
          href="/practice"
          className="mb-5 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          返回练习列表
        </Link>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Target className="h-6 w-6 text-primary" />
          新建练习
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          选老师 + 主题 + 题量,系统会让 AI 老师给出学习计划,然后逐题出题、即时反馈。
        </p>

        <div className="mt-7 space-y-6">
          {/* 老师 */}
          <Field
            icon={<GraduationCap className="h-4 w-4" />}
            label="出题老师"
            hint="老师的 system prompt 会决定题目的视角和深度。"
          >
            {agentsQuery.isLoading ? (
              <div className="h-24 animate-pulse rounded-xl bg-secondary/50" />
            ) : (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {agents.map((a) => {
                  const active = a.agent_key === agentKey;
                  return (
                    <button
                      key={a.agent_key}
                      type="button"
                      onClick={() => setAgentKey(a.agent_key)}
                      className={cn(
                        "flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left transition",
                        active
                          ? "border-primary bg-primary/5"
                          : "border-border/60 hover:border-foreground/30 hover:bg-secondary/50",
                      )}
                    >
                      <span className="text-lg">{a.emoji || "🎓"}</span>
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate text-sm font-medium">
                          {a.display_name}
                        </span>
                        <span className="truncate text-[11px] text-muted-foreground">
                          {a.tagline || a.role || "AI 老师"}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
            {selectedAgent ? (
              <p className="mt-2 text-xs text-muted-foreground">
                <Sparkles className="mr-1 inline h-3 w-3 text-primary" />
                推荐主题:{(selectedAgent.domains || []).slice(0, 3).join(" · ") ||
                  "可自由输入"}
              </p>
            ) : null}
          </Field>

          {/* 主题 */}
          <Field
            icon={<Brain className="h-4 w-4" />}
            label="练习主题 / 知识点"
            hint="可写大方向(『LRU 缓存』)或具体范围(『LSM-Tree 写放大』)。越具体,出题越精准。"
          >
            <Textarea
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="例:期权 Black-Scholes 定价 / Kafka exactly-once / 高考二次函数综合题"
              rows={3}
              maxLength={200}
              className="resize-none"
            />
            <div className="mt-1 text-right text-[11px] text-muted-foreground">
              {topic.length}/200
            </div>
          </Field>

          {/* 时长 + 题量 */}
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <Field icon={<Clock className="h-4 w-4" />} label="目标时长(分钟)">
              <SegmentGroup
                options={MINUTE_OPTIONS.map((n) => ({ id: n, label: `${n}` }))}
                value={targetMinutes}
                onChange={(v) => setTargetMinutes(v as number)}
              />
            </Field>
            <Field icon={<Target className="h-4 w-4" />} label="目标题量">
              <SegmentGroup
                options={COUNT_OPTIONS.map((n) => ({ id: n, label: `${n}` }))}
                value={targetCount}
                onChange={(v) => setTargetCount(v as number)}
              />
            </Field>
          </div>

          {/* 题型 */}
          <Field
            label="允许的题型"
            hint="练习时 AI 会从这些题型里挑;选 ≥ 1 个。"
          >
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {KIND_OPTIONS.map((k) => {
                const active = allowedKinds.includes(k.id);
                return (
                  <button
                    key={k.id}
                    type="button"
                    onClick={() => toggleKind(k.id)}
                    className={cn(
                      "rounded-xl border px-3 py-2.5 text-left transition",
                      active
                        ? "border-primary bg-primary/5"
                        : "border-border/60 hover:border-foreground/30 hover:bg-secondary/50",
                    )}
                  >
                    <div className="text-sm font-medium">{k.label}</div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground">
                      {k.desc}
                    </div>
                  </button>
                );
              })}
            </div>
          </Field>

          {/* 难度策略 */}
          <Field label="难度策略" hint="自适应会根据你的答题表现升降一档。">
            <div className="flex flex-wrap gap-2">
              {DIFFICULTY_OPTIONS.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => setDifficulty(d.id)}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-sm transition",
                    difficulty === d.id
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border/60 text-muted-foreground hover:border-foreground/30",
                  )}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </Field>

          {/* 模型档位 */}
          <Field
            label="出题模型"
            hint="题量大时建议选 low/medium 控制成本;高质量但慢用 high+。"
          >
            <div className="flex flex-wrap gap-2">
              {tiers.length === 0 ? (
                <div className="h-9 w-48 animate-pulse rounded-full bg-secondary/50" />
              ) : (
                tiers.map((t) => (
                  <button
                    key={t.tier}
                    type="button"
                    onClick={() => setModelTier(t.tier)}
                    className={cn(
                      "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition",
                      modelTier === t.tier
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border/60 text-muted-foreground hover:border-foreground/30",
                    )}
                    title={t.desc}
                  >
                    <span className="font-medium">{t.label}</span>
                    <span className="opacity-70">· {t.display}</span>
                  </button>
                ))
              )}
            </div>
          </Field>

          {/* 错误 */}
          {error ? (
            <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}

          {/* 提交 */}
          <div className="flex items-center justify-between border-t border-border/60 pt-5">
            <p className="text-xs text-muted-foreground">
              点开始后,系统会让老师 LLM 先制定学习计划,然后逐题出题。
            </p>
            <Button
              size="lg"
              disabled={!canSubmit}
              onClick={() => createMutation.mutate()}
              className="gap-2"
            >
              {createMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  正在让老师规划…
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" /> 开始练习
                </>
              )}
            </Button>
          </div>
        </div>
      </main>
    </div>
  );
}

// 小组件
function Field({
  icon,
  label,
  hint,
  children,
}: {
  icon?: React.ReactNode;
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <Label className="flex items-center gap-1.5 text-sm font-medium">
        {icon}
        {label}
      </Label>
      {hint ? (
        <p className="mb-2 mt-0.5 text-[11px] text-muted-foreground">{hint}</p>
      ) : (
        <div className="h-1.5" />
      )}
      {children}
    </div>
  );
}

function SegmentGroup<T extends string | number>({
  options,
  value,
  onChange,
}: {
  options: { id: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex rounded-xl border border-border/60 bg-secondary/30 p-0.5">
      {options.map((o) => (
        <button
          key={String(o.id)}
          type="button"
          onClick={() => onChange(o.id)}
          className={cn(
            "rounded-lg px-3 py-1.5 text-sm transition",
            value === o.id
              ? "bg-background font-medium text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

