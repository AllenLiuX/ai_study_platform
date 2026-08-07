"use client";

import { Play, RotateCcw, Timer, Trophy, Zap } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { normalizeAnswer, type TimedDrillConfig } from "@/lib/practice/spec";
import { cn } from "@/lib/utils";

type Phase = "idle" | "running" | "done";

function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function TimedDrill({
  config,
  storageKey,
}: {
  config: TimedDrillConfig;
  storageKey?: string;
}) {
  const bestKey = storageKey ? `drill-best-${storageKey}` : null;
  const [phase, setPhase] = useState<Phase>("idle");
  const [timeLeft, setTimeLeft] = useState(config.durationSec);
  const [queue, setQueue] = useState<number[]>([]);
  const [qpos, setQpos] = useState(0);
  const [score, setScore] = useState(0);
  const [streak, setStreak] = useState(0);
  const [best, setBest] = useState(0);
  const [flash, setFlash] = useState<"none" | "ok" | "bad">("none");
  const [textVal, setTextVal] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (bestKey) setBest(Number(localStorage.getItem(bestKey)) || 0);
  }, [bestKey]);

  const currentIdx = queue[qpos] ?? 0;
  const item = config.items[currentIdx];

  const start = useCallback(() => {
    setQueue(shuffle(config.items.map((_, i) => i)));
    setQpos(0);
    setScore(0);
    setStreak(0);
    setTimeLeft(config.durationSec);
    setTextVal("");
    setPhase("running");
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [config.items, config.durationSec]);

  useEffect(() => {
    if (phase !== "running") return;
    if (timeLeft <= 0) {
      setPhase("done");
      if (bestKey && score > best) {
        setBest(score);
        localStorage.setItem(bestKey, String(score));
      }
      return;
    }
    const t = setTimeout(() => setTimeLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [phase, timeLeft, score, best, bestKey]);

  function advance(correct: boolean) {
    setFlash(correct ? "ok" : "bad");
    setTimeout(() => setFlash("none"), 220);
    if (correct) {
      setScore((s) => s + 1);
      setStreak((s) => s + 1);
    } else {
      setStreak(0);
    }
    setQpos((p) => {
      const nextPos = p + 1;
      if (nextPos >= queue.length) {
        setQueue(shuffle(config.items.map((_, i) => i)));
        return 0;
      }
      return nextPos;
    });
    setTextVal("");
  }

  function submitText() {
    if (!item) return;
    const val = normalizeAnswer(textVal);
    if (!val) return;
    const cands = [item.answer, ...(item.accept ?? [])].map(normalizeAnswer);
    advance(cands.includes(val));
    inputRef.current?.focus();
  }

  if (phase === "idle" || phase === "done") {
    return (
      <div className="rounded-2xl border border-border bg-background/60 p-6 text-center">
        {phase === "done" ? (
          <>
            <Trophy className="mx-auto mb-2 h-8 w-8 text-amber-500" />
            <div className="text-2xl font-bold">{score}</div>
            <div className="text-sm text-muted-foreground">
              本次答对 · 历史最佳 {Math.max(best, score)}
            </div>
          </>
        ) : (
          <>
            <Timer className="mx-auto mb-2 h-8 w-8 text-primary" />
            <div className="text-sm text-muted-foreground">
              限时 {config.durationSec} 秒，尽可能多答对。
              {best > 0 && ` 历史最佳 ${best}`}
            </div>
          </>
        )}
        <Button className="mt-4" onClick={start}>
          {phase === "done" ? (
            <RotateCcw className="mr-1.5 h-4 w-4" />
          ) : (
            <Play className="mr-1.5 h-4 w-4" />
          )}
          {phase === "done" ? "再来一次" : "开始"}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between text-sm">
        <span className="flex items-center gap-1 font-semibold text-primary">
          <Timer className="h-4 w-4" />
          {timeLeft}s
        </span>
        <span className="text-muted-foreground">
          得分 <span className="font-semibold text-foreground">{score}</span>
        </span>
        <span className="flex items-center gap-1 text-amber-600">
          <Zap className="h-4 w-4" />
          {streak}
        </span>
      </div>

      <div
        className={cn(
          "rounded-2xl border p-6 text-center transition-colors",
          flash === "ok"
            ? "border-emerald-400 bg-emerald-50"
            : flash === "bad"
              ? "border-rose-400 bg-rose-50"
              : "border-border bg-background/60",
        )}
      >
        <div className="text-2xl font-semibold">{item?.prompt}</div>
      </div>

      {config.mode === "choice" ? (
        <div className="grid grid-cols-2 gap-2">
          {(item?.options ?? []).map((opt, i) => (
            <button
              key={i}
              type="button"
              onClick={() => advance(opt === item.answer)}
              className="rounded-xl border border-border bg-background px-3 py-3 text-sm transition hover:border-primary hover:bg-primary/5"
            >
              {opt}
            </button>
          ))}
        </div>
      ) : (
        <div className="flex gap-2">
          <input
            ref={inputRef}
            value={textVal}
            onChange={(e) => setTextVal(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submitText()}
            placeholder="输入答案后回车"
            className="h-11 flex-1 rounded-xl border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <Button onClick={submitText}>提交</Button>
        </div>
      )}
    </div>
  );
}
