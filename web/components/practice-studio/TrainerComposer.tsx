"use client";

import {
  AppWindow,
  ArrowLeft,
  ArrowUpDown,
  GitBranch,
  Layers,
  Loader2,
  type LucideIcon,
  RefreshCw,
  SlidersHorizontal,
  Sparkles,
  Timer,
  Volume2,
  Wand2,
} from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { practiceStudioApi } from "@/lib/api";
import type {
  PracticeSpecRecord,
  PracticeStudioPlan,
  TrainerTemplateChoice,
} from "@/lib/types";
import { cn } from "@/lib/utils";

const EXAMPLES = [
  "复利模拟器：本金、年化、年数可调，看资产增长曲线",
  "日语 N5 假名 60 秒闪认计时训练",
  "英语高频词影子跟读，带中文对照",
  "德州扑克翻前范围决策沙盘",
  "高一物理抛体运动模拟器，调角度和初速看落点",
  "GRE 核心词间隔重复记忆卡",
];

const TEMPLATE_CHOICES: {
  value: TrainerTemplateChoice;
  label: string;
  icon: LucideIcon;
  hint: string;
}[] = [
  { value: "auto", label: "AI 自动", icon: Wand2, hint: "由 AI 选形态" },
  { value: "simulator", label: "参数模拟器", icon: SlidersHorizontal, hint: "调滑块看曲线" },
  { value: "timed_drill", label: "计时训练", icon: Timer, hint: "限时快答" },
  { value: "audio_trainer", label: "音频跟读", icon: Volume2, hint: "TTS / 节拍器" },
  { value: "flashcards_srs", label: "记忆卡", icon: Layers, hint: "间隔重复" },
  { value: "drag_order", label: "拖拽构造", icon: ArrowUpDown, hint: "排序 / 归类" },
  { value: "decision_tree", label: "决策沙盘", icon: GitBranch, hint: "情境决策" },
  { value: "app", label: "定制应用", icon: AppWindow, hint: "现场写小应用" },
];

function planToChoice(plan: PracticeStudioPlan): TrainerTemplateChoice {
  if (plan.kind === "app") return "app";
  const tid = plan.template_id ?? "";
  const found = TEMPLATE_CHOICES.find((c) => c.value === tid);
  return (found?.value as TrainerTemplateChoice) ?? "auto";
}

export interface TrainerComposerProps {
  onCreated: (rec: PracticeSpecRecord) => void;
}

/**
 * 两步式训练器生成（对齐「生成老师」的流程）：
 *  1. 用户写一段描述 → AI 规划出形态 / 目标 / 要点 / 可编辑的生成指令
 *  2. 用户确认或微调这份规划 → 真正生成训练器
 */
export function TrainerComposer({ onCreated }: TrainerComposerProps) {
  const [description, setDescription] = useState("");

  const [planning, setPlanning] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);
  const [plan, setPlan] = useState<PracticeStudioPlan | null>(null);

  // 规划确认后可编辑的字段
  const [title, setTitle] = useState("");
  const [domain, setDomain] = useState("");
  const [difficulty, setDifficulty] = useState("");
  const [goal, setGoal] = useState("");
  const [choice, setChoice] = useState<TrainerTemplateChoice>("auto");
  const [genPrompt, setGenPrompt] = useState("");

  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);

  const busy = planning || generating;

  function applyPlan(p: PracticeStudioPlan) {
    setPlan(p);
    setTitle(p.title);
    setDomain(p.domain);
    setDifficulty(p.difficulty ?? "");
    setGoal(p.goal);
    setChoice(planToChoice(p));
    setGenPrompt(p.generation_prompt);
  }

  async function runPlan() {
    setPlanError(null);
    setGenError(null);
    if (description.trim().length < 4) {
      setPlanError("请再具体描述一下你想练什么");
      return;
    }
    setPlanning(true);
    try {
      const p = await practiceStudioApi.plan({ description: description.trim() });
      applyPlan(p);
    } catch (err) {
      setPlanError(err instanceof Error ? err.message : "规划失败，请稍后再试");
    } finally {
      setPlanning(false);
    }
  }

  async function runGenerate() {
    setGenError(null);
    if (genPrompt.trim().length < 4) {
      setGenError("生成指令太短了，补充一下要练什么、怎么练");
      return;
    }
    setGenerating(true);
    try {
      const rec = await practiceStudioApi.generate({
        description: genPrompt.trim(),
        domain: domain.trim() || undefined,
        difficulty: difficulty.trim() || undefined,
        goal: goal.trim() || undefined,
        title: title.trim() || undefined,
        template_id: choice === "auto" ? undefined : choice,
      });
      onCreated(rec);
    } catch (err) {
      setGenError(err instanceof Error ? err.message : "生成失败，请稍后再试");
    } finally {
      setGenerating(false);
    }
  }

  function backToDescribe() {
    setPlan(null);
    setGenError(null);
  }

  // ---------------------------------------------------------------------------
  // 步骤 1：描述
  // ---------------------------------------------------------------------------
  if (!plan) {
    return (
      <section className="rounded-3xl border border-border bg-card p-5 shadow-card">
        <div className="mb-2 flex items-center gap-2 text-sm font-medium text-primary">
          <Wand2 className="h-4 w-4" />
          第 1 步 · 描述你想练什么
        </div>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          placeholder="例如：做一个凯利公式下注模拟器，胜率和赔率可调，显示最优下注比例和资金增长曲线"
          disabled={planning}
          className="w-full resize-y rounded-2xl border border-input bg-background px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <div className="mt-3 flex flex-wrap gap-1.5">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              disabled={planning}
              onClick={() => setDescription(ex)}
              className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground transition hover:border-primary/40 hover:text-primary"
            >
              {ex}
            </button>
          ))}
        </div>
        {planError && <p className="mt-3 text-sm text-destructive">{planError}</p>}
        <div className="mt-4 flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            AI 先出一份规划，你确认后再生成
          </span>
          <Button onClick={runPlan} disabled={planning}>
            {planning ? (
              <>
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                正在规划…
              </>
            ) : (
              <>
                <Sparkles className="mr-1.5 h-4 w-4" />
                分析并规划
              </>
            )}
          </Button>
        </div>
      </section>
    );
  }

  // ---------------------------------------------------------------------------
  // 步骤 2：确认 / 微调规划 → 生成
  // ---------------------------------------------------------------------------
  return (
    <section className="space-y-4 rounded-3xl border border-border bg-card p-5 shadow-card">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium text-primary">
          <Sparkles className="h-4 w-4" />
          第 2 步 · 确认规划，再生成
        </div>
        <button
          type="button"
          onClick={backToDescribe}
          disabled={busy}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground transition hover:text-foreground disabled:opacity-50"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          改描述
        </button>
      </div>

      <p className="rounded-xl bg-secondary/60 px-3 py-2 text-xs text-muted-foreground">
        这是 AI 根据你的描述做的规划，可直接生成，也可以微调形态、目标或生成指令后再生成。
      </p>

      {/* 训练器形态 */}
      <div className="space-y-2">
        <Label>训练器形态</Label>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {TEMPLATE_CHOICES.map((t) => {
            const Icon = t.icon;
            const active = choice === t.value;
            return (
              <button
                key={t.value}
                type="button"
                disabled={busy}
                onClick={() => setChoice(t.value)}
                className={cn(
                  "flex flex-col gap-1 rounded-xl border p-2.5 text-left text-xs transition",
                  active
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/40",
                )}
              >
                <span className="flex items-center gap-1.5 text-sm font-medium">
                  <Icon className="h-4 w-4 text-primary" />
                  {t.label}
                </span>
                <span className="text-[11px] text-muted-foreground">{t.hint}</span>
              </button>
            );
          })}
        </div>
        {plan.template_label && (
          <p className="text-[11px] text-muted-foreground">
            AI 推荐：{plan.template_label}
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="trainer-title">标题</Label>
          <Input
            id="trainer-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="训练器标题"
            maxLength={200}
            disabled={busy}
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="trainer-domain">领域</Label>
            <Input
              id="trainer-domain"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder="如 量化 / 日语"
              maxLength={60}
              disabled={busy}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="trainer-difficulty">难度</Label>
            <Input
              id="trainer-difficulty"
              value={difficulty}
              onChange={(e) => setDifficulty(e.target.value)}
              placeholder="如 入门 / N5"
              maxLength={40}
              disabled={busy}
            />
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="trainer-goal">训练目标</Label>
        <Input
          id="trainer-goal"
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          placeholder="用它要达成什么"
          maxLength={500}
          disabled={busy}
        />
      </div>

      {plan.outline.length > 0 && (
        <div className="space-y-1.5">
          <Label>AI 规划要点</Label>
          <ul className="space-y-1 rounded-xl border border-border bg-background/60 p-3 text-xs text-muted-foreground">
            {plan.outline.map((item, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-primary">·</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="trainer-prompt">生成指令（会直接交给生成器，可编辑）</Label>
        <Textarea
          id="trainer-prompt"
          rows={7}
          value={genPrompt}
          onChange={(e) => setGenPrompt(e.target.value)}
          className="text-[13px] leading-relaxed"
          maxLength={4000}
          disabled={busy}
        />
        <p className="text-[11px] text-muted-foreground">
          越具体越好：交互方式、关键参数 / 题目 / 卡片 / 节点、数量、难度、判分或反馈方式。
        </p>
      </div>

      {genError && (
        <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {genError}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={runPlan}
          disabled={busy}
        >
          {planning ? (
            <>
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              重新规划…
            </>
          ) : (
            <>
              <RefreshCw className="mr-1.5 h-4 w-4" />
              重新规划
            </>
          )}
        </Button>
        <Button onClick={runGenerate} disabled={busy}>
          {generating ? (
            <>
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              正在生成…（约 10~30 秒）
            </>
          ) : (
            <>
              <Sparkles className="mr-1.5 h-4 w-4" />
              生成训练器
            </>
          )}
        </Button>
      </div>
    </section>
  );
}
