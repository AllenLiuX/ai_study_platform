"use client";

import { useMemo, useState } from "react";

import { MiniLineChart } from "@/components/widgets/common/MiniLineChart";

const STEPS = 60;

/** 凯利公式 / 仓位计算器 widget：给定胜率与赔率，求最优下注比例。 */
export function KellyCalculator() {
  const [winPct, setWinPct] = useState(55);
  const [payoff, setPayoff] = useState(1); // b = 盈亏比

  const { fStar, gStar, curve, markerX } = useMemo(() => {
    const p = Math.min(0.99, Math.max(0.01, winPct / 100));
    const b = Math.max(0.05, payoff);
    const f = (b * p - (1 - p)) / b; // 凯利最优比例
    const g = (frac: number) =>
      frac >= 1 ? null : p * Math.log(1 + frac * b) + (1 - p) * Math.log(1 - frac);
    const curveData: (number | null)[] = [];
    for (let i = 0; i < STEPS; i++) {
      const frac = (i / (STEPS - 1)) * 0.99;
      curveData.push(g(frac));
    }
    const clampedF = Math.min(0.99, Math.max(0, f));
    const marker = Math.round((clampedF / 0.99) * (STEPS - 1));
    return {
      fStar: f,
      gStar: f > 0 ? (g(Math.min(0.99, f)) ?? 0) : 0,
      curve: curveData,
      markerX: f > 0 ? marker : null,
    };
  }, [winPct, payoff]);

  const positive = fStar > 0;

  return (
    <div className="rounded-3xl border border-border bg-card p-5 shadow-card">
      <h3 className="mb-4 text-sm font-semibold tracking-tight">
        凯利公式 · 仓位计算器
      </h3>

      <div className="mb-4 flex flex-wrap gap-4">
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          胜率(%)
          <input
            type="number"
            min={1}
            max={99}
            value={winPct}
            onChange={(e) =>
              setWinPct(Math.min(99, Math.max(1, Number(e.target.value) || 1)))
            }
            className="h-8 w-20 rounded-md border border-input bg-background px-2 text-sm text-foreground"
          />
        </label>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          盈亏比 b
          <input
            type="number"
            min={0.1}
            step={0.1}
            value={payoff}
            onChange={(e) =>
              setPayoff(Math.max(0.1, Number(e.target.value) || 0.1))
            }
            className="h-8 w-20 rounded-md border border-input bg-background px-2 text-sm text-foreground"
          />
        </label>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Metric
          label="全凯利仓位"
          value={positive ? `${(fStar * 100).toFixed(1)}%` : "0%"}
          tone={positive ? "accent" : "danger"}
        />
        <Metric
          label="半凯利(稳健)"
          value={positive ? `${(fStar * 50).toFixed(1)}%` : "0%"}
        />
        <Metric
          label="期望增长率"
          value={positive ? `${(gStar * 100).toFixed(2)}%/注` : "≤0"}
        />
      </div>

      <div className="mt-4 text-[11px] font-medium text-muted-foreground">
        资金增长率 g(f) 随下注比例的变化
      </div>
      <MiniLineChart
        series={[{ label: "log 增长率 g(f)", color: "#4f46e5", data: curve }]}
        markerX={markerX}
      />

      {!positive && (
        <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-600">
          当前胜率与赔率下期望为负（无优势），凯利建议不下注。
        </p>
      )}
      <p className="mt-2 text-xs text-muted-foreground">
        虚线标出最优比例。实战常用「半凯利」降低波动。公式：f* = p − (1−p)/b。
      </p>
    </div>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "accent" | "danger";
}) {
  return (
    <div className="rounded-xl border border-border bg-background/60 p-3">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div
        className={
          tone === "accent"
            ? "mt-1 text-lg font-semibold text-primary"
            : tone === "danger"
              ? "mt-1 text-lg font-semibold text-rose-600"
              : "mt-1 text-lg font-semibold"
        }
      >
        {value}
      </div>
    </div>
  );
}
