"use client";

import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  buildPreset,
  comboKey as key,
  comboLabel,
  comboWeight as weight,
  IDX,
  TOTAL_COMBOS,
} from "@/lib/poker/range";
import { cn } from "@/lib/utils";

/** 起手范围矩阵 widget：13×13，可点选、切换预设。 */
export function RangeMatrix() {
  const [selected, setSelected] = useState<Set<string>>(() =>
    buildPreset("tight"),
  );

  const stats = useMemo(() => {
    let combos = 0;
    for (const k of selected) {
      const [i, j] = k.split("-").map(Number);
      combos += weight(i, j);
    }
    return {
      hands: selected.size,
      combos,
      pct: ((combos / TOTAL_COMBOS) * 100).toFixed(1),
    };
  }, [selected]);

  function toggle(i: number, j: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      const k = key(i, j);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }

  return (
    <div className="rounded-3xl border border-border bg-card p-5 shadow-card">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold tracking-tight">起手范围矩阵</h3>
        <div className="text-xs text-muted-foreground">
          {stats.hands} 手 · {stats.combos} 组合 ·{" "}
          <span className="font-medium text-foreground">{stats.pct}%</span>
        </div>
      </div>

      <div
        className="grid gap-[2px]"
        style={{ gridTemplateColumns: "repeat(13, minmax(0, 1fr))" }}
      >
        {IDX.map((i) =>
          IDX.map((j) => {
            const k = key(i, j);
            const on = selected.has(k);
            const isPair = i === j;
            const isSuited = i < j;
            return (
              <button
                key={k}
                type="button"
                onClick={() => toggle(i, j)}
                className={cn(
                  "flex aspect-square items-center justify-center rounded-[4px] border text-[8px] font-medium transition sm:text-[10px]",
                  on
                    ? "border-primary bg-primary text-primary-foreground"
                    : isPair
                      ? "border-border bg-secondary text-secondary-foreground"
                      : isSuited
                        ? "border-border bg-muted/60 text-muted-foreground"
                        : "border-border bg-card text-muted-foreground hover:bg-secondary",
                )}
                title={comboLabel(i, j)}
              >
                {comboLabel(i, j)}
              </button>
            );
          }),
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" onClick={() => setSelected(buildPreset("tight"))}>
          紧 (~早位)
        </Button>
        <Button size="sm" variant="secondary" onClick={() => setSelected(buildPreset("wide"))}>
          宽 (~按钮位)
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setSelected(buildPreset("all"))}>
          全选
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
          清空
        </Button>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        对角线=口袋对，右上三角=同花，左下三角=非同花。点击标记你会入池的起手牌。
      </p>
    </div>
  );
}
