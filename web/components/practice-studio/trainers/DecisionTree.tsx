"use client";

import { Check, RotateCcw, X } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import type { DecisionTreeConfig } from "@/lib/practice/spec";
import { cn } from "@/lib/utils";

export function DecisionTree({ config }: { config: DecisionTreeConfig }) {
  const [nodeId, setNodeId] = useState(config.start);
  const [picked, setPicked] = useState<number | null>(null);
  const [optimalCount, setOptimalCount] = useState(0);
  const [total, setTotal] = useState(0);
  const [finished, setFinished] = useState(false);

  const node = config.nodes[nodeId];
  if (!node) {
    return (
      <div className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
        决策节点缺失。
      </div>
    );
  }

  const chosen = picked != null ? node.options[picked] : null;

  function choose(i: number) {
    if (picked != null) return;
    const opt = node.options[i];
    setPicked(i);
    setTotal((t) => t + 1);
    if (opt.optimal) setOptimalCount((c) => c + 1);
  }

  function next() {
    if (chosen?.next && config.nodes[chosen.next]) {
      setNodeId(chosen.next);
      setPicked(null);
    } else {
      setFinished(true);
    }
  }

  function restart() {
    setNodeId(config.start);
    setPicked(null);
    setOptimalCount(0);
    setTotal(0);
    setFinished(false);
  }

  if (finished) {
    return (
      <div className="rounded-2xl border border-border bg-background/60 p-6 text-center">
        <div className="text-sm text-muted-foreground">本轮完成</div>
        <div className="mt-1 text-2xl font-bold">
          最优决策 {optimalCount}/{total}
        </div>
        <Button className="mt-4" variant="secondary" size="sm" onClick={restart}>
          <RotateCcw className="mr-1 h-3.5 w-3.5" />
          再来一局
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>情境决策</span>
        <span>
          最优 {optimalCount}/{total}
        </span>
      </div>

      <div className="rounded-2xl border border-border bg-background/60 p-4">
        <p className="text-sm leading-6">{node.situation}</p>
      </div>

      <div className="space-y-2">
        {node.options.map((opt, i) => {
          const isPicked = picked === i;
          return (
            <button
              key={i}
              type="button"
              disabled={picked != null}
              onClick={() => choose(i)}
              className={cn(
                "w-full rounded-xl border px-3 py-2.5 text-left text-sm transition",
                picked == null
                  ? "border-border bg-background hover:border-primary hover:bg-primary/5"
                  : isPicked
                    ? opt.optimal
                      ? "border-emerald-400 bg-emerald-50"
                      : "border-rose-400 bg-rose-50"
                    : opt.optimal
                      ? "border-emerald-300 bg-emerald-50/50"
                      : "border-border opacity-60",
              )}
            >
              <span className="flex items-center gap-2">
                {picked != null &&
                  (opt.optimal ? (
                    <Check className="h-4 w-4 shrink-0 text-emerald-600" />
                  ) : isPicked ? (
                    <X className="h-4 w-4 shrink-0 text-rose-600" />
                  ) : null)}
                {opt.label}
              </span>
            </button>
          );
        })}
      </div>

      {chosen && (
        <div className="space-y-3">
          <div
            className={cn(
              "rounded-xl p-3 text-sm",
              chosen.optimal ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800",
            )}
          >
            <span className="font-semibold">
              {chosen.optimal ? "最优选择 · " : "可以更好 · "}
            </span>
            {chosen.feedback}
          </div>
          <Button size="sm" onClick={next}>
            {chosen.next && config.nodes[chosen.next] ? "继续" : "查看结果"}
          </Button>
        </div>
      )}
    </div>
  );
}
