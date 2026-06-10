"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { AGENT_ORDER, AGENTS } from "@/lib/agents";
import { studentApi } from "@/lib/api";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { Grade, LearnerType } from "@/lib/types";
import { cn } from "@/lib/utils";

const GRADES: Grade[] = ["初一", "初二", "初三", "高一", "高二", "高三"];

const TEXTBOOKS = [
  "人教版",
  "北师大版",
  "苏教版",
  "译林版",
  "外研版",
  "沪教版",
  "其它/不确定",
];

const TARGET_EXAMS = ["月考", "期中", "期末", "中考", "高考", "暂无明确考试"];

const DOMAIN_PRESETS = [
  "系统设计",
  "算法",
  "面试准备",
  "量化交易",
  "Agent / LLM",
  "数据科学",
  "编程进阶",
  "学术研究",
  "考公 / 留学",
  "兴趣自学",
];

type Step = 0 | 1 | 2;

interface FormState {
  name: string;
  learner_type: LearnerType;
  // K12 学生
  grade: Grade | "";
  textbook_version: string;
  target_exam: string;
  focus_subjects: string[];
  // 自由学习者
  focus_domains: string[];
  // 共用
  learning_goal: string;
}

export default function OnboardingPage() {
  // Next 14 在静态导出时要求 useSearchParams 必须被 Suspense 边界包裹
  return (
    <Suspense fallback={<div className="min-h-screen bg-app-gradient" />}>
      <OnboardingInner />
    </Suspense>
  );
}

function OnboardingInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // ?edit=true:重新走 onboarding 编辑个人资料 (StudentHeader / AppHeader 的入口走这条)
  // 没参数时:仅未 onboarded 用户能进,已完成的会被 redirect 回 dashboard
  const isEditMode = searchParams?.get("edit") === "true";
  const [step, setStep] = useState<Step>(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>({
    name: "",
    learner_type: "k12_student",
    grade: "",
    textbook_version: "人教版",
    target_exam: "期末",
    focus_subjects: ["math"],
    focus_domains: [],
    learning_goal: "",
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = createSupabaseBrowserClient();
      const { data } = await supabase.auth.getUser();
      const meta = (data.user?.user_metadata ?? {}) as { name?: string };
      if (cancelled) return;
      try {
        const profile = await studentApi.getProfile();
        if (cancelled) return;
        // 已完成 onboarding 且没显式走编辑入口 → 不允许重走流程,直接回 dashboard
        if (profile.onboarding_completed && !isEditMode) {
          router.replace("/dashboard");
          return;
        }
        setForm((prev) => ({
          ...prev,
          name: profile.name || meta.name || prev.name,
          learner_type: profile.learner_type ?? prev.learner_type,
          grade: (profile.grade as Grade | null) || prev.grade,
          textbook_version: profile.textbook_version || prev.textbook_version,
          target_exam: profile.target_exam || prev.target_exam,
          focus_subjects:
            profile.focus_subjects && profile.focus_subjects.length > 0
              ? profile.focus_subjects
              : prev.focus_subjects,
          focus_domains:
            profile.focus_domains && profile.focus_domains.length > 0
              ? profile.focus_domains
              : prev.focus_domains,
          learning_goal: profile.learning_goal || prev.learning_goal,
        }));
      } catch {
        if (!cancelled && meta.name) {
          setForm((prev) => ({ ...prev, name: prev.name || meta.name! }));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router, isEditMode]);

  const isK12 = form.learner_type === "k12_student";

  const canGoNext = useMemo(() => {
    if (step === 0) return !!form.name;
    if (step === 1) {
      if (isK12) return !!form.grade && form.focus_subjects.length > 0;
      return form.focus_domains.length > 0 || form.learning_goal.trim().length >= 4;
    }
    return isK12 ? !!form.target_exam : true;
  }, [step, form, isK12]);

  function toggleSubject(id: string) {
    setForm((prev) => ({
      ...prev,
      focus_subjects: prev.focus_subjects.includes(id)
        ? prev.focus_subjects.filter((s) => s !== id)
        : [...prev.focus_subjects, id],
    }));
  }

  function toggleDomain(name: string) {
    setForm((prev) => ({
      ...prev,
      focus_domains: prev.focus_domains.includes(name)
        ? prev.focus_domains.filter((s) => s !== name)
        : [...prev.focus_domains, name],
    }));
  }

  async function handleSubmit() {
    setSubmitting(true);
    setError(null);
    try {
      await studentApi.updateProfile({
        name: form.name,
        learner_type: form.learner_type,
        grade: isK12 ? ((form.grade || null) as Grade | null) : null,
        textbook_version: isK12 ? form.textbook_version : null,
        target_exam: isK12 ? form.target_exam : null,
        focus_subjects: isK12 ? form.focus_subjects : [],
        focus_domains: isK12 ? [] : form.focus_domains,
        learning_goal: form.learning_goal,
        // 编辑模式:保持原有的 onboarding_completed(后端 PATCH 会保留旧值,这里不传也行,
        // 显式 true 是为了首次 onboarding 一进就把这个 flag 置好)
        onboarding_completed: true,
      });
      router.replace("/dashboard");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败,请重试");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-app-gradient">
      <div className="container max-w-2xl py-12">
        {isEditMode && (
          <Link
            href="/dashboard"
            className="mb-4 inline-flex items-center gap-1 text-xs text-muted-foreground transition hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            返回驾驶舱
          </Link>
        )}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">
              {isEditMode ? "编辑个人资料" : "完善基础信息"}
            </h1>
            {isEditMode && (
              <p className="mt-1 text-xs text-muted-foreground">
                调整学习者类型 / 重点科目 / 关注领域 / 目标 — 保存后立即生效,
                后续推荐任务与老师人设会跟着更新
              </p>
            )}
          </div>
          <span className="text-sm text-muted-foreground">
            步骤 {step + 1} / 3
          </span>
        </div>

        <div className="mb-8 flex gap-2">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className={cn(
                "h-1.5 flex-1 rounded-full transition",
                i <= step ? "bg-primary" : "bg-secondary",
              )}
            />
          ))}
        </div>

        {step === 0 && (
          <Card className="animate-fade-in">
            <CardHeader>
              <CardTitle>第一步:你是谁?用平台学什么?</CardTitle>
              <CardDescription>
                两种模式 — K12 学生(语数外+学科辅导)与自由学习者(任意方向,可自定义老师)。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="name">昵称</Label>
                <Input
                  id="name"
                  value={form.name}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, name: e.target.value }))
                  }
                  placeholder="例如:小明"
                />
              </div>

              <div className="space-y-2">
                <Label>我想用平台:</Label>
                <div className="grid gap-2 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() =>
                      setForm((p) => ({ ...p, learner_type: "k12_student" }))
                    }
                    className={cn(
                      "rounded-2xl border p-4 text-left transition",
                      isK12
                        ? "border-primary bg-primary/5 shadow-card"
                        : "border-border hover:border-primary/40",
                    )}
                  >
                    <div className="mb-1 flex items-center gap-2">
                      <span className="text-xl">🎒</span>
                      <span className="font-medium">K12 学科辅导</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      语数外为主,班主任 + 学科老师 + 进度沉淀
                    </p>
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setForm((p) => ({ ...p, learner_type: "free_learner" }))
                    }
                    className={cn(
                      "rounded-2xl border p-4 text-left transition",
                      !isK12
                        ? "border-primary bg-primary/5 shadow-card"
                        : "border-border hover:border-primary/40",
                    )}
                  >
                    <div className="mb-1 flex items-center gap-2">
                      <span className="text-xl">🚀</span>
                      <span className="font-medium">自由学习</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      自定义老师 / 资料库 / 笔记,适合面试、转岗、自学新领域
                    </p>
                  </button>
                </div>
              </div>

              {isK12 && (
                <>
                  <div className="space-y-2">
                    <Label>年级</Label>
                    <div className="grid grid-cols-3 gap-2">
                      {GRADES.map((g) => (
                        <button
                          key={g}
                          type="button"
                          onClick={() => setForm((p) => ({ ...p, grade: g }))}
                          className={cn(
                            "rounded-xl border px-3 py-2.5 text-sm transition",
                            form.grade === g
                              ? "border-primary bg-primary/5 text-primary shadow-card"
                              : "border-border hover:border-primary/40",
                          )}
                        >
                          {g}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="textbook">教材版本</Label>
                    <Select
                      id="textbook"
                      value={form.textbook_version}
                      onChange={(e) =>
                        setForm((p) => ({
                          ...p,
                          textbook_version: e.target.value,
                        }))
                      }
                    >
                      {TEXTBOOKS.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </Select>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        )}

        {step === 1 && isK12 && (
          <Card className="animate-fade-in">
            <CardHeader>
              <CardTitle>第二步:最想提升哪几科?</CardTitle>
              <CardDescription>可以多选。先聚焦 1-3 科,效果更明显。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {AGENT_ORDER.filter((t) => AGENTS[t].subjectId).map((type) => {
                const agent = AGENTS[type];
                const id = agent.subjectId!;
                const selected = form.focus_subjects.includes(id);
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => toggleSubject(id)}
                    className={cn(
                      "flex w-full items-center gap-4 rounded-2xl border p-4 text-left transition",
                      selected
                        ? "border-primary bg-primary/5 shadow-card"
                        : "border-border hover:border-primary/40",
                    )}
                  >
                    <div
                      className={cn(
                        "flex h-12 w-12 items-center justify-center rounded-xl text-2xl transition",
                        selected
                          ? "bg-primary text-primary-foreground"
                          : "bg-foreground text-background",
                      )}
                    >
                      {agent.emoji}
                    </div>
                    <div className="flex-1">
                      <div className="font-medium">{agent.displayName}</div>
                      <div className="text-xs text-muted-foreground">
                        {agent.tagline}
                      </div>
                    </div>
                    <div
                      className={cn(
                        "h-5 w-5 rounded-full border-2 transition",
                        selected
                          ? "border-primary bg-primary"
                          : "border-border bg-transparent",
                      )}
                    />
                  </button>
                );
              })}
            </CardContent>
          </Card>
        )}

        {step === 1 && !isK12 && (
          <Card className="animate-fade-in">
            <CardHeader>
              <CardTitle>第二步:你想专攻什么方向?</CardTitle>
              <CardDescription>
                选几个感兴趣的方向(可多选,也可在「目标」里自由描述)。后续可以为每个方向创建专属老师。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>方向 tags (任意组合,后续可改)</Label>
                <div className="flex flex-wrap gap-2">
                  {DOMAIN_PRESETS.map((d) => {
                    const selected = form.focus_domains.includes(d);
                    return (
                      <button
                        key={d}
                        type="button"
                        onClick={() => toggleDomain(d)}
                        className={cn(
                          "rounded-full border px-3 py-1.5 text-sm transition",
                          selected
                            ? "border-primary bg-primary/5 text-primary"
                            : "border-border hover:border-primary/40",
                        )}
                      >
                        {selected ? "✓ " : ""}
                        {d}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="goal-free">学习目标 (具体一点效果更好)</Label>
                <Textarea
                  id="goal-free"
                  rows={4}
                  value={form.learning_goal}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, learning_goal: e.target.value }))
                  }
                  placeholder="例如:面试顶级量化公司 AI Lab Senior ML Engineer 职位,想系统补齐算法系统设计 / Agent 框架 / 事件驱动量化系统 / 期权交易系统设计"
                />
              </div>
            </CardContent>
          </Card>
        )}

        {step === 2 && (
          <Card className="animate-fade-in">
            <CardHeader>
              <CardTitle>
                {isK12 ? "第三步:近期目标" : "第三步:确认一下学习目标"}
              </CardTitle>
              <CardDescription>
                {isK12
                  ? "设一个具体一点的目标,AI 班主任会基于它给你安排节奏。"
                  : "目标越具体,AI 老师就越容易帮你拆解路径。可以再补充一些细节。"}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {isK12 && (
                <div className="space-y-2">
                  <Label>临近的考试</Label>
                  <div className="grid grid-cols-3 gap-2">
                    {TARGET_EXAMS.map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() =>
                          setForm((p) => ({ ...p, target_exam: t }))
                        }
                        className={cn(
                          "rounded-xl border px-3 py-2.5 text-sm transition",
                          form.target_exam === t
                            ? "border-primary bg-primary/5 text-primary shadow-card"
                            : "border-border hover:border-primary/40",
                        )}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="goal">学习目标 {isK12 && "(可选)"}</Label>
                <Textarea
                  id="goal"
                  rows={4}
                  value={form.learning_goal}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, learning_goal: e.target.value }))
                  }
                  placeholder={
                    isK12
                      ? "例如:期末数学想从 75 提到 90;英语作文想能稳定写 70+"
                      : "例如:8 周内能从容应对系统设计面试,能讲清楚一套事件驱动量化系统的核心组件"
                  }
                />
              </div>
            </CardContent>
          </Card>
        )}

        {error && (
          <p className="mt-4 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        <div className="mt-6 flex justify-between gap-3">
          {step === 0 && isEditMode ? (
            <Button
              variant="outline"
              onClick={() => router.replace("/dashboard")}
              disabled={submitting}
            >
              取消
            </Button>
          ) : (
            <Button
              variant="outline"
              onClick={() => setStep((s) => (s > 0 ? ((s - 1) as Step) : s))}
              disabled={step === 0 || submitting}
            >
              上一步
            </Button>
          )}
          {step < 2 ? (
            <Button
              size="lg"
              onClick={() => setStep((s) => (s < 2 ? ((s + 1) as Step) : s))}
              disabled={!canGoNext}
            >
              下一步
            </Button>
          ) : (
            <Button
              size="lg"
              onClick={handleSubmit}
              disabled={!canGoNext || submitting}
            >
              {submitting
                ? "保存中…"
                : isEditMode
                  ? "保存修改"
                  : "开始学习 →"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
