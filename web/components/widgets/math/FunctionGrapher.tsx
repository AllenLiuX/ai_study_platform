"use client";

import { useMemo, useState } from "react";

import { cn } from "@/lib/utils";

type FnType = "linear" | "quadratic" | "sine" | "inverse" | "exp";

const FN_META: Record<
  FnType,
  { label: string; params: ("a" | "b" | "c")[]; formula: (a: number, b: number, c: number) => string }
> = {
  linear: { label: "一次函数", params: ["a", "b"], formula: (a, b) => `y = ${a}x + ${b}` },
  quadratic: {
    label: "二次函数",
    params: ["a", "b", "c"],
    formula: (a, b, c) => `y = ${a}x² + ${b}x + ${c}`,
  },
  sine: {
    label: "正弦函数",
    params: ["a", "b", "c"],
    formula: (a, b, c) => `y = ${a}·sin(${b}x + ${c})`,
  },
  inverse: { label: "反比例", params: ["a"], formula: (a) => `y = ${a} / x` },
  exp: { label: "指数函数", params: ["a", "b"], formula: (a, b) => `y = ${a}·e^(${b}x)` },
};

const XMIN = -10;
const XMAX = 10;
const YMIN = -10;
const YMAX = 10;
const W = 340;
const H = 240;

function evalFn(type: FnType, x: number, a: number, b: number, c: number): number {
  switch (type) {
    case "linear":
      return a * x + b;
    case "quadratic":
      return a * x * x + b * x + c;
    case "sine":
      return a * Math.sin(b * x + c);
    case "inverse":
      return x === 0 ? NaN : a / x;
    case "exp":
      return a * Math.exp(b * x);
  }
}

/** 数学函数图像探索器 widget：调系数看图像，无依赖 SVG 绘制。 */
export function FunctionGrapher() {
  const [type, setType] = useState<FnType>("quadratic");
  const [a, setA] = useState(1);
  const [b, setB] = useState(0);
  const [c, setC] = useState(0);

  const mapX = (x: number) => ((x - XMIN) / (XMAX - XMIN)) * W;
  const mapY = (y: number) => H - ((y - YMIN) / (YMAX - YMIN)) * H;

  const path = useMemo(() => {
    let d = "";
    let pen = false;
    const steps = 480;
    for (let i = 0; i <= steps; i++) {
      const x = XMIN + (i / steps) * (XMAX - XMIN);
      const y = evalFn(type, x, a, b, c);
      if (!Number.isFinite(y) || Math.abs(y) > 40) {
        pen = false;
        continue;
      }
      d += `${pen ? "L" : "M"}${mapX(x).toFixed(1)} ${mapY(y).toFixed(1)} `;
      pen = true;
    }
    return d.trim();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, a, b, c]);

  const meta = FN_META[type];
  const gridLines = [-8, -6, -4, -2, 2, 4, 6, 8];

  return (
    <div className="rounded-3xl border border-border bg-card p-5 shadow-card">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold tracking-tight">函数图像探索</h3>
        <code className="rounded-md bg-secondary px-2 py-1 text-xs font-medium">
          {meta.formula(a, b, c)}
        </code>
      </div>

      <div className="mb-3 flex flex-wrap gap-1.5">
        {(Object.keys(FN_META) as FnType[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setType(t)}
            className={cn(
              "rounded-full border px-2.5 py-1 text-xs transition",
              t === type
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:bg-secondary",
            )}
          >
            {FN_META[t].label}
          </button>
        ))}
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="w-full rounded-xl bg-background">
        {gridLines.map((g) => (
          <line
            key={`vx${g}`}
            x1={mapX(g)}
            x2={mapX(g)}
            y1={0}
            y2={H}
            className="text-border"
            stroke="currentColor"
            strokeWidth={0.5}
          />
        ))}
        {gridLines.map((g) => (
          <line
            key={`hy${g}`}
            x1={0}
            x2={W}
            y1={mapY(g)}
            y2={mapY(g)}
            className="text-border"
            stroke="currentColor"
            strokeWidth={0.5}
          />
        ))}
        {/* 坐标轴 */}
        <line x1={mapX(0)} x2={mapX(0)} y1={0} y2={H} className="text-muted-foreground" stroke="currentColor" strokeWidth={1} />
        <line x1={0} x2={W} y1={mapY(0)} y2={mapY(0)} className="text-muted-foreground" stroke="currentColor" strokeWidth={1} />
        <path d={path} fill="none" stroke="#4f46e5" strokeWidth={2} vectorEffect="non-scaling-stroke" />
      </svg>

      <div className="mt-4 space-y-3">
        {meta.params.includes("a") && (
          <Slider label="a" value={a} onChange={setA} />
        )}
        {meta.params.includes("b") && (
          <Slider label="b" value={b} onChange={setB} />
        )}
        {meta.params.includes("c") && (
          <Slider label="c" value={c} onChange={setC} />
        )}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        拖动系数滑块，观察斜率、开口、平移、周期如何随参数变化。
      </p>
    </div>
  );
}

function Slider({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex items-center gap-3 text-xs">
      <span className="w-4 font-medium text-foreground">{label}</span>
      <input
        type="range"
        min={-5}
        max={5}
        step={0.5}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-secondary accent-primary"
      />
      <span className="w-10 text-right tabular-nums text-muted-foreground">
        {value}
      </span>
    </label>
  );
}
