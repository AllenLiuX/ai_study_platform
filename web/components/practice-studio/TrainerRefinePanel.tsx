"use client";

import { Check, Loader2, Send, Wand2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { practiceStudioApi } from "@/lib/api";
import type { PracticeSpecRecord } from "@/lib/types";

const QUICK_EDITS = [
  "增加难度",
  "再多来点内容",
  "换个更实用的场景",
  "加上计时和计分",
  "做得更灵活复杂，必要时换成定制应用",
  "简化一下，更聚焦",
];

interface AppliedEdit {
  instruction: string;
}

export interface TrainerRefinePanelProps {
  specId: string;
  onUpdated: (rec: PracticeSpecRecord) => void;
}

/**
 * 生成后的自然语言迭代修改面板：
 * 用户用一句话描述想改哪里 → 后端基于当前 spec 重写 → 训练器就地更新。
 */
export function TrainerRefinePanel({ specId, onUpdated }: TrainerRefinePanelProps) {
  const [instruction, setInstruction] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<AppliedEdit[]>([]);

  async function submit(text?: string) {
    const value = (text ?? instruction).trim();
    setError(null);
    if (value.length < 2) {
      setError("说一句你想改哪里，比如「把题目换成初中难度」");
      return;
    }
    setPending(true);
    try {
      const rec = await practiceStudioApi.refine(specId, { instruction: value });
      setHistory((h) => [...h, { instruction: value }]);
      setInstruction("");
      onUpdated(rec);
    } catch (err) {
      setError(err instanceof Error ? err.message : "修改失败，请稍后再试");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="rounded-3xl border border-border bg-card p-5 shadow-card">
      <div className="mb-1 flex items-center gap-2 text-sm font-medium text-primary">
        <Wand2 className="h-4 w-4" />
        改一改（用一句话描述）
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        觉得太简单、想加功能、换场景、调难度都行——描述你想改的地方，AI 会当场改这台训练器的界面和玩法。
      </p>

      {history.length > 0 && (
        <div className="mb-3 space-y-1.5">
          {history.map((h, i) => (
            <div
              key={i}
              className="flex items-start gap-2 rounded-xl bg-secondary/60 px-3 py-2 text-xs"
            >
              <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
              <span className="text-muted-foreground">已应用：{h.instruction}</span>
            </div>
          ))}
        </div>
      )}

      <div className="mb-2 flex flex-wrap gap-1.5">
        {QUICK_EDITS.map((q) => (
          <button
            key={q}
            type="button"
            disabled={pending}
            onClick={() => submit(q)}
            className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground transition hover:border-primary/40 hover:text-primary disabled:opacity-50"
          >
            {q}
          </button>
        ))}
      </div>

      <div className="flex items-end gap-2">
        <textarea
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          rows={2}
          placeholder="例如：多加 10 张卡片并按主题分组；或者改成可以调节难度的模拟器"
          disabled={pending}
          className="flex-1 resize-y rounded-2xl border border-input bg-background px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
        />
        <Button onClick={() => submit()} disabled={pending} className="shrink-0">
          {pending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
        </Button>
      </div>
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
      {pending && (
        <p className="mt-2 text-xs text-muted-foreground">
          正在按你的要求改写…（约 10~30 秒）
        </p>
      )}
    </section>
  );
}
