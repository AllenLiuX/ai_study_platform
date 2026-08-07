"use client";

import { useState } from "react";

interface Stage {
  key: string;
  label: string;
  value: number;
}

const DEFAULT_STAGES: Stage[] = [
  { key: "impression", label: "曝光", value: 100000 },
  { key: "enter", label: "进入直播间", value: 12000 },
  { key: "engage", label: "互动 / 停留", value: 4000 },
  { key: "order", label: "下单", value: 900 },
  { key: "paid", label: "成交", value: 700 },
];

function fmt(n: number): string {
  return n.toLocaleString("zh-CN");
}

/** 直播转化漏斗 widget：各环节转化率 + GMV 复盘。 */
export function ConversionFunnel() {
  const [stages, setStages] = useState<Stage[]>(DEFAULT_STAGES);
  const [aov, setAov] = useState(89);

  const top = stages[0].value || 1;
  const gmv = stages[stages.length - 1].value * aov;

  function update(idx: number, value: number) {
    setStages((prev) =>
      prev.map((s, i) => (i === idx ? { ...s, value: Math.max(0, value) } : s)),
    );
  }

  return (
    <div className="rounded-3xl border border-border bg-card p-5 shadow-card">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold tracking-tight">转化漏斗 · GMV 复盘</h3>
        <div className="text-right">
          <div className="text-[11px] text-muted-foreground">预估 GMV</div>
          <div className="text-lg font-semibold text-primary">
            ¥{fmt(Math.round(gmv))}
          </div>
        </div>
      </div>

      <div className="space-y-2.5">
        {stages.map((s, i) => {
          const ratioToTop = s.value / top;
          const stepConv =
            i === 0 ? 1 : s.value / (stages[i - 1].value || 1);
          return (
            <div key={s.key}>
              <div className="mb-1 flex items-center justify-between text-xs">
                <span className="font-medium">{s.label}</span>
                <span className="text-muted-foreground">
                  {i > 0 && (
                    <span className="mr-2">
                      环节转化 {(stepConv * 100).toFixed(1)}%
                    </span>
                  )}
                  <input
                    type="number"
                    value={s.value}
                    min={0}
                    onChange={(e) => update(i, Number(e.target.value) || 0)}
                    className="h-7 w-24 rounded-md border border-input bg-background px-2 text-right text-xs text-foreground"
                  />
                </span>
              </div>
              <div className="h-6 overflow-hidden rounded-lg bg-secondary">
                <div
                  className="flex h-full items-center rounded-lg bg-primary/80 px-2 text-[10px] font-medium text-primary-foreground"
                  style={{ width: `${Math.max(ratioToTop * 100, 4)}%` }}
                >
                  {fmt(s.value)}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          客单价 ¥
          <input
            type="number"
            value={aov}
            min={0}
            onChange={(e) => setAov(Math.max(0, Number(e.target.value) || 0))}
            className="h-8 w-24 rounded-md border border-input bg-background px-2 text-sm text-foreground"
          />
        </label>
        <div className="text-xs text-muted-foreground">
          整体转化（曝光→成交）：
          <span className="font-semibold text-foreground">
            {((stages[stages.length - 1].value / top) * 100).toFixed(2)}%
          </span>
        </div>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        改任意环节数字，实时看转化率与 GMV 变化 —— 找出最该优化的漏斗瓶颈。
      </p>
    </div>
  );
}
