"use client";

import { Shuffle } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { MiniLineChart } from "@/components/widgets/common/MiniLineChart";

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sma(data: number[], window: number): (number | null)[] {
  const out: (number | null)[] = [];
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    sum += data[i];
    if (i >= window) sum -= data[i - window];
    out.push(i >= window - 1 ? sum / window : null);
  }
  return out;
}

const N = 240;

function runBacktest(seed: number, fast: number, slow: number) {
  const rng = mulberry32(seed);
  const price: number[] = [100];
  for (let i = 1; i < N; i++) {
    const r = (rng() - 0.5) * 0.03 + 0.0005; // 波动 + 微弱上行漂移
    price.push(Math.max(1, price[i - 1] * (1 + r)));
  }
  const fastMA = sma(price, fast);
  const slowMA = sma(price, slow);

  const equity: number[] = [1];
  let eq = 1;
  let trades = 0;
  let prevPos = 0;
  const stratDaily: number[] = [];
  for (let i = 1; i < N; i++) {
    const f = fastMA[i - 1];
    const s = slowMA[i - 1];
    const pos = f != null && s != null && f > s ? 1 : 0;
    if (pos !== prevPos) trades++;
    prevPos = pos;
    const ret = price[i] / price[i - 1] - 1;
    const dayRet = pos * ret;
    stratDaily.push(dayRet);
    eq *= 1 + dayRet;
    equity.push(eq);
  }
  const buyhold = price.map((p) => p / price[0]);

  // 最大回撤
  let peak = -Infinity;
  let maxDD = 0;
  for (const v of equity) {
    peak = Math.max(peak, v);
    maxDD = Math.min(maxDD, v / peak - 1);
  }
  // 夏普（年化）
  const mean = stratDaily.reduce((a, b) => a + b, 0) / stratDaily.length;
  const variance =
    stratDaily.reduce((a, b) => a + (b - mean) ** 2, 0) / stratDaily.length;
  const std = Math.sqrt(variance) || 1e-9;
  const sharpe = (mean / std) * Math.sqrt(252);

  return {
    price,
    fastMA,
    slowMA,
    equity,
    buyhold,
    stats: {
      stratReturn: equity[equity.length - 1] - 1,
      bhReturn: buyhold[buyhold.length - 1] - 1,
      maxDD,
      sharpe,
      trades,
    },
  };
}

function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

/** 量化回测沙盘 widget：均线交叉策略 vs 买入持有。 */
export function BacktestSandbox() {
  const [seed, setSeed] = useState(42);
  const [fast, setFast] = useState(5);
  const [slow, setSlow] = useState(20);

  const bt = useMemo(
    () => runBacktest(seed, fast, Math.max(fast + 1, slow)),
    [seed, fast, slow],
  );
  const s = bt.stats;

  return (
    <div className="rounded-3xl border border-border bg-card p-5 shadow-card">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold tracking-tight">回测沙盘 · 均线交叉</h3>
        <Button size="sm" variant="secondary" onClick={() => setSeed((x) => x + 1)}>
          <Shuffle className="mr-1 h-3.5 w-3.5" />
          换一段行情
        </Button>
      </div>

      <div className="mb-4 flex flex-wrap gap-4">
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          快线
          <input
            type="number"
            min={2}
            max={50}
            value={fast}
            onChange={(e) => setFast(Math.max(2, Number(e.target.value) || 2))}
            className="h-8 w-16 rounded-md border border-input bg-background px-2 text-sm text-foreground"
          />
        </label>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          慢线
          <input
            type="number"
            min={3}
            max={120}
            value={slow}
            onChange={(e) => setSlow(Math.max(3, Number(e.target.value) || 3))}
            className="h-8 w-16 rounded-md border border-input bg-background px-2 text-sm text-foreground"
          />
        </label>
      </div>

      <div className="text-[11px] font-medium text-muted-foreground">净值曲线</div>
      <MiniLineChart
        series={[
          { label: "策略净值", color: "#4f46e5", data: bt.equity },
          { label: "买入持有", color: "#94a3b8", data: bt.buyhold },
        ]}
      />

      <div className="mt-3 text-[11px] font-medium text-muted-foreground">
        价格与均线
      </div>
      <MiniLineChart
        series={[
          { label: "价格", color: "#0f172a", data: bt.price },
          { label: `MA${fast}`, color: "#16a34a", data: bt.fastMA },
          { label: `MA${Math.max(fast + 1, slow)}`, color: "#f59e0b", data: bt.slowMA },
        ]}
      />

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Stat label="策略收益" value={pct(s.stratReturn)} good={s.stratReturn >= 0} />
        <Stat label="买入持有" value={pct(s.bhReturn)} good={s.bhReturn >= 0} />
        <Stat label="最大回撤" value={pct(s.maxDD)} good={false} />
        <Stat label="夏普" value={s.sharpe.toFixed(2)} good={s.sharpe >= 1} />
        <Stat label="交易次数" value={String(s.trades)} />
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        行情为随机游走模拟，仅用于理解「均线交叉 / 回撤 / 夏普」等概念，不构成投资建议。
      </p>
    </div>
  );
}

function Stat({
  label,
  value,
  good,
}: {
  label: string;
  value: string;
  good?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-background/60 p-2.5">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div
        className={
          good === undefined
            ? "mt-0.5 text-sm font-semibold"
            : good
              ? "mt-0.5 text-sm font-semibold text-emerald-600"
              : "mt-0.5 text-sm font-semibold text-rose-600"
        }
      >
        {value}
      </div>
    </div>
  );
}
