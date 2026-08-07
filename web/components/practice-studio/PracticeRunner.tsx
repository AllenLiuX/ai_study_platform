"use client";

import { RotateCcw, Trophy } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { isGradable, type PracticeSpec } from "@/lib/practice/spec";
import { cn } from "@/lib/utils";

import { PracticeBlockCard } from "./blocks";
import { SandboxFrame } from "./SandboxFrame";

export function PracticeRunner({ spec }: { spec: PracticeSpec }) {
  const [attempt, setAttempt] = useState(0);
  const [results, setResults] = useState<Record<number, boolean>>({});

  const blocks = spec.blocks ?? [];
  const gradableTotal = useMemo(
    () => blocks.filter(isGradable).length,
    [blocks],
  );

  if (spec.mode === "sandbox" && spec.sandbox_html) {
    return <SandboxFrame html={spec.sandbox_html} />;
  }

  if (!blocks.length) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-muted/40 p-6 text-center text-sm text-muted-foreground">
        这份练习没有可渲染的内容。
      </div>
    );
  }

  const answered = Object.keys(results).length;
  const correct = Object.values(results).filter(Boolean).length;
  const progress = gradableTotal ? Math.round((answered / gradableTotal) * 100) : 0;
  const allDone = gradableTotal > 0 && answered >= gradableTotal;

  function reset() {
    setResults({});
    setAttempt((a) => a + 1);
  }

  return (
    <div className="space-y-4">
      {gradableTotal > 0 && (
        <div className="sticky top-16 z-10 rounded-2xl border border-border bg-background/90 p-3 backdrop-blur">
          <div className="mb-1.5 flex items-center justify-between text-xs">
            <span className="text-muted-foreground">
              进度 {answered}/{gradableTotal} · 正确{" "}
              <span className="font-semibold text-foreground">{correct}</span>
            </span>
            <button
              type="button"
              onClick={reset}
              className="flex items-center gap-1 text-muted-foreground transition hover:text-primary"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              重做
            </button>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
            <div
              className={cn(
                "h-full rounded-full transition-all",
                allDone ? "bg-emerald-500" : "bg-primary",
              )}
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {allDone && (
        <div className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
          <Trophy className="h-6 w-6 text-emerald-600" />
          <div>
            <div className="text-sm font-semibold text-emerald-800">
              完成！正确 {correct}/{gradableTotal}（
              {Math.round((correct / gradableTotal) * 100)}%）
            </div>
            <button
              type="button"
              onClick={reset}
              className="text-xs text-emerald-700 underline-offset-2 hover:underline"
            >
              再练一遍
            </button>
          </div>
        </div>
      )}

      <div key={attempt} className="space-y-4">
        {blocks.map((block, i) => (
          <PracticeBlockCard
            key={i}
            block={block}
            index={i}
            onResult={(ok) => setResults((prev) => ({ ...prev, [i]: ok }))}
          />
        ))}
      </div>

      <div className="pt-2">
        <Button variant="secondary" size="sm" onClick={reset}>
          <RotateCcw className="mr-1 h-3.5 w-3.5" />
          重做这套练习
        </Button>
      </div>
    </div>
  );
}
