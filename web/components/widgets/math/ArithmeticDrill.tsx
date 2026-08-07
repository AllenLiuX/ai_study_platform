"use client";

import { Check, RotateCcw, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Op = "+" | "-" | "×" | "÷" | "mix";

interface Problem {
  a: number;
  b: number;
  op: "+" | "-" | "×" | "÷";
  answer: number;
}

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function makeProblem(op: Op, level: number): Problem {
  const max = level === 1 ? 10 : level === 2 ? 50 : 100;
  const pick: "+" | "-" | "×" | "÷" =
    op === "mix"
      ? (["+", "-", "×", "÷"] as const)[randInt(0, 3)]
      : op;
  if (pick === "+") {
    const a = randInt(1, max);
    const b = randInt(1, max);
    return { a, b, op: "+", answer: a + b };
  }
  if (pick === "-") {
    const a = randInt(1, max);
    const b = randInt(1, a);
    return { a, b, op: "-", answer: a - b };
  }
  if (pick === "×") {
    const cap = level === 1 ? 9 : level === 2 ? 12 : 20;
    const a = randInt(2, cap);
    const b = randInt(2, cap);
    return { a, b, op: "×", answer: a * b };
  }
  // 除法：保证整除
  const b = randInt(2, level === 1 ? 9 : 12);
  const q = randInt(2, level === 1 ? 9 : 12);
  return { a: b * q, b, op: "÷", answer: q };
}

/** 口算 / 计算特训 widget：随机出题、即时判分、连击统计。 */
export function ArithmeticDrill() {
  const [op, setOp] = useState<Op>("mix");
  const [level, setLevel] = useState(1);
  const [problem, setProblem] = useState<Problem>(() => makeProblem("mix", 1));
  const [input, setInput] = useState("");
  const [correct, setCorrect] = useState(0);
  const [total, setTotal] = useState(0);
  const [streak, setStreak] = useState(0);
  const [best, setBest] = useState(0);
  const [feedback, setFeedback] = useState<"ok" | "no" | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const next = useCallback(() => {
    setProblem(makeProblem(op, level));
    setInput("");
    setFeedback(null);
    inputRef.current?.focus();
  }, [op, level]);

  useEffect(() => {
    next();
  }, [op, level, next]);

  function submit() {
    if (input.trim() === "") return;
    const val = Number(input);
    const ok = val === problem.answer;
    setTotal((t) => t + 1);
    if (ok) {
      setCorrect((c) => c + 1);
      setStreak((s) => {
        const ns = s + 1;
        setBest((b) => Math.max(b, ns));
        return ns;
      });
      setFeedback("ok");
      setTimeout(next, 350);
    } else {
      setStreak(0);
      setFeedback("no");
    }
  }

  function reset() {
    setCorrect(0);
    setTotal(0);
    setStreak(0);
    setBest(0);
    next();
  }

  const acc = total ? Math.round((correct / total) * 100) : 0;

  return (
    <div className="rounded-3xl border border-border bg-card p-5 shadow-card">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold tracking-tight">口算 · 计算特训</h3>
        <Button size="sm" variant="ghost" onClick={reset}>
          <RotateCcw className="mr-1 h-3.5 w-3.5" />
          重置
        </Button>
      </div>

      <div className="mb-3 flex flex-wrap gap-1.5">
        {(["+", "-", "×", "÷", "mix"] as Op[]).map((o) => (
          <button
            key={o}
            type="button"
            onClick={() => setOp(o)}
            className={cn(
              "rounded-full border px-3 py-1 text-xs transition",
              o === op
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:bg-secondary",
            )}
          >
            {o === "mix" ? "混合" : o}
          </button>
        ))}
        <span className="mx-1 w-px self-stretch bg-border" />
        {[1, 2, 3].map((l) => (
          <button
            key={l}
            type="button"
            onClick={() => setLevel(l)}
            className={cn(
              "rounded-full border px-3 py-1 text-xs transition",
              l === level
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:bg-secondary",
            )}
          >
            {["初级", "中级", "高级"][l - 1]}
          </button>
        ))}
      </div>

      <div
        className={cn(
          "flex items-center justify-center gap-3 rounded-2xl border py-6 text-3xl font-semibold transition",
          feedback === "ok"
            ? "border-emerald-300 bg-emerald-50"
            : feedback === "no"
              ? "border-rose-300 bg-rose-50"
              : "border-border bg-background/60",
        )}
      >
        <span>
          {problem.a} {problem.op} {problem.b} =
        </span>
        <input
          ref={inputRef}
          type="number"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          className="w-24 rounded-lg border border-input bg-background px-2 py-1 text-center text-2xl text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
        {feedback === "ok" && <Check className="h-6 w-6 text-emerald-600" />}
        {feedback === "no" && <X className="h-6 w-6 text-rose-600" />}
      </div>

      {feedback === "no" && (
        <div className="mt-2 flex items-center justify-between text-xs">
          <span className="text-rose-600">
            正确答案：{problem.answer}
          </span>
          <Button size="sm" variant="secondary" onClick={next}>
            下一题
          </Button>
        </div>
      )}

      <div className="mt-4 grid grid-cols-4 gap-3 text-center">
        <Stat label="正确" value={`${correct}/${total}`} />
        <Stat label="正确率" value={`${acc}%`} />
        <Stat label="连击" value={String(streak)} />
        <Stat label="最高连击" value={String(best)} />
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        输入答案后按回车提交，答对自动出下一题 —— 练速度也练稳定性。
      </p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-background/60 p-2">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-sm font-semibold">{value}</div>
    </div>
  );
}
