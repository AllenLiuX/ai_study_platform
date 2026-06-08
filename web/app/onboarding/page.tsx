"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

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
import type { Grade } from "@/lib/types";
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

type Step = 0 | 1 | 2;

interface FormState {
  name: string;
  grade: Grade | "";
  textbook_version: string;
  target_exam: string;
  focus_subjects: string[];
  learning_goal: string;
}

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>({
    name: "",
    grade: "",
    textbook_version: "人教版",
    target_exam: "期末",
    focus_subjects: ["math"],
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
        if (profile.onboarding_completed) {
          router.replace("/dashboard");
          return;
        }
        setForm((prev) => ({
          ...prev,
          name: profile.name || meta.name || prev.name,
          grade: (profile.grade as Grade | null) || prev.grade,
          textbook_version: profile.textbook_version || prev.textbook_version,
          target_exam: profile.target_exam || prev.target_exam,
          focus_subjects:
            profile.focus_subjects && profile.focus_subjects.length > 0
              ? profile.focus_subjects
              : prev.focus_subjects,
          learning_goal: profile.learning_goal || prev.learning_goal,
        }));
      } catch {
        // 如果后端未启动也不卡用户,继续填表
        if (!cancelled && meta.name) {
          setForm((prev) => ({ ...prev, name: prev.name || meta.name! }));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  const canGoNext = useMemo(() => {
    if (step === 0) return !!form.name && !!form.grade;
    if (step === 1) return form.focus_subjects.length > 0;
    return !!form.target_exam;
  }, [step, form]);

  function toggleSubject(id: string) {
    setForm((prev) => ({
      ...prev,
      focus_subjects: prev.focus_subjects.includes(id)
        ? prev.focus_subjects.filter((s) => s !== id)
        : [...prev.focus_subjects, id],
    }));
  }

  async function handleSubmit() {
    setSubmitting(true);
    setError(null);
    try {
      await studentApi.updateProfile({
        name: form.name,
        grade: (form.grade || null) as Grade | null,
        textbook_version: form.textbook_version,
        target_exam: form.target_exam,
        focus_subjects: form.focus_subjects,
        learning_goal: form.learning_goal,
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
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-xl font-semibold">完善基础信息</h1>
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
              <CardTitle>第一步:你是谁?</CardTitle>
              <CardDescription>
                告诉我们你的昵称和年级,后续 AI 老师会根据这些信息因材施教。
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
            </CardContent>
          </Card>
        )}

        {step === 1 && (
          <Card className="animate-fade-in">
            <CardHeader>
              <CardTitle>第二步:最想提升哪几科?</CardTitle>
              <CardDescription>
                可以多选。Phase 0 我们先聚焦数学、英语、语文三科。
              </CardDescription>
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
                        "flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br text-2xl text-white",
                        agent.gradient,
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

        {step === 2 && (
          <Card className="animate-fade-in">
            <CardHeader>
              <CardTitle>第三步:近期目标</CardTitle>
              <CardDescription>
                设一个具体一点的目标,AI 班主任会基于它给你安排节奏。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
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
              <div className="space-y-2">
                <Label htmlFor="goal">学习目标 (可选)</Label>
                <Textarea
                  id="goal"
                  rows={4}
                  value={form.learning_goal}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, learning_goal: e.target.value }))
                  }
                  placeholder="例如:期末数学想从 75 提到 90;英语作文想能稳定写 70+"
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
          <Button
            variant="outline"
            onClick={() => setStep((s) => (s > 0 ? ((s - 1) as Step) : s))}
            disabled={step === 0 || submitting}
          >
            上一步
          </Button>
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
              {submitting ? "保存中…" : "开始学习 →"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
