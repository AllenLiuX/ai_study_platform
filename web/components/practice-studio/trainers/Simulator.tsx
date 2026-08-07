"use client";

import { useMemo, useState } from "react";

import {
  type ChartSeries,
  MiniLineChart,
} from "@/components/widgets/common/MiniLineChart";
import { compile } from "@/lib/practice/formula";
import type { SimulatorConfig } from "@/lib/practice/spec";

const PALETTE = ["#6366f1", "#10b981", "#f59e0b", "#ef4444", "#06b6d4"];
const SAMPLES = 60;

export function Simulator({ config }: { config: SimulatorConfig }) {
  const [values, setValues] = useState<Record<string, number>>(() => {
    const init: Record<string, number> = {};
    for (const p of config.params) init[p.id] = p.default;
    return init;
  });

  const outputs = useMemo(
    () => config.outputs.map((o) => ({ ...o, fn: compile(o.expr) })),
    [config.outputs],
  );

  const chartCompiled = useMemo(() => {
    if (!config.chart) return null;
    return config.chart.series.map((s) => ({ label: s.label, fn: compile(s.expr) }));
  }, [config.chart]);

  const chartSeries: ChartSeries[] = useMemo(() => {
    if (!config.chart || !chartCompiled) return [];
    const { xId, xMin, xMax } = config.chart;
    return chartCompiled.map((s, i) => {
      const data: (number | null)[] = [];
      for (let k = 0; k < SAMPLES; k++) {
        const x = xMin + ((xMax - xMin) * k) / (SAMPLES - 1);
        const v = s.fn({ ...values, [xId]: x });
        data.push(Number.isFinite(v) ? v : null);
      }
      return { label: s.label, color: PALETTE[i % PALETTE.length], data };
    });
  }, [config.chart, chartCompiled, values]);

  function fmt(v: number, precision = 2): string {
    if (!Number.isFinite(v)) return "—";
    if (Math.abs(v) >= 1e6 || (Math.abs(v) < 1e-4 && v !== 0)) {
      return v.toExponential(2);
    }
    return v.toFixed(precision);
  }

  return (
    <div className="space-y-5">
      {/* 输出读数 */}
      {outputs.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-2">
          {outputs.map((o, i) => (
            <div
              key={i}
              className="rounded-xl border border-border bg-background/60 p-3"
            >
              <div className="text-xs text-muted-foreground">{o.label}</div>
              <div className="mt-1 text-lg font-semibold tabular-nums">
                {fmt(o.fn(values), o.precision)}
                {o.unit && (
                  <span className="ml-1 text-xs font-normal text-muted-foreground">
                    {o.unit}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 曲线 */}
      {chartSeries.length > 0 && (
        <div className="rounded-xl border border-border bg-background/60 p-3">
          <MiniLineChart series={chartSeries} height={180} />
          <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
            {chartSeries.map((s) => (
              <span key={s.label} className="flex items-center gap-1">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ background: s.color }}
                />
                {s.label}
              </span>
            ))}
            {config.chart?.xLabel && (
              <span className="ml-auto">x：{config.chart.xLabel}</span>
            )}
          </div>
        </div>
      )}

      {/* 参数滑块 */}
      <div className="space-y-4">
        {config.params.map((p) => (
          <div key={p.id}>
            <div className="mb-1 flex items-center justify-between text-sm">
              <span className="font-medium">{p.label}</span>
              <span className="tabular-nums text-muted-foreground">
                {fmt(values[p.id], 2)}
                {p.unit ? ` ${p.unit}` : ""}
              </span>
            </div>
            <input
              type="range"
              min={p.min}
              max={p.max}
              step={p.step}
              value={values[p.id]}
              onChange={(e) =>
                setValues((prev) => ({ ...prev, [p.id]: Number(e.target.value) }))
              }
              className="w-full accent-primary"
            />
          </div>
        ))}
      </div>
    </div>
  );
}
