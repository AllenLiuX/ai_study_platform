"use client";

export interface ChartSeries {
  label: string;
  color: string;
  data: (number | null)[];
}

/** 轻量 SVG 折线图（无依赖）。所有 series 共用一套纵轴刻度。 */
export function MiniLineChart({
  series,
  height = 130,
  markerX,
}: {
  series: ChartSeries[];
  height?: number;
  /** 可选：在某个 x 索引处画一条竖线（如标记最优点） */
  markerX?: number | null;
}) {
  const W = 320;
  const H = height;
  const padX = 6;
  const padY = 8;

  const all: number[] = [];
  let n = 0;
  for (const s of series) {
    n = Math.max(n, s.data.length);
    for (const v of s.data) if (v != null && Number.isFinite(v)) all.push(v);
  }
  if (all.length === 0 || n < 2) {
    return <div className="h-[130px] rounded-xl bg-muted/40" />;
  }
  const min = Math.min(...all);
  const max = Math.max(...all);
  const span = max - min || 1;

  const x = (i: number) => padX + (i / (n - 1)) * (W - padX * 2);
  const y = (v: number) => padY + (1 - (v - min) / span) * (H - padY * 2);

  function pathFor(data: (number | null)[]): string {
    let d = "";
    let pen = false;
    data.forEach((v, i) => {
      if (v == null || !Number.isFinite(v)) {
        pen = false;
        return;
      }
      d += `${pen ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)} `;
      pen = true;
    });
    return d.trim();
  }

  return (
    <div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="h-[130px] w-full"
      >
        {markerX != null && markerX >= 0 && markerX < n && (
          <line
            x1={x(markerX)}
            x2={x(markerX)}
            y1={padY}
            y2={H - padY}
            stroke="currentColor"
            strokeWidth={1}
            strokeDasharray="3 3"
            className="text-muted-foreground/50"
          />
        )}
        {series.map((s) => (
          <path
            key={s.label}
            d={pathFor(s.data)}
            fill="none"
            stroke={s.color}
            strokeWidth={1.6}
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
      <div className="mt-1.5 flex flex-wrap gap-3">
        {series.map((s) => (
          <span key={s.label} className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ background: s.color }}
            />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}
