"use client";

import { Check, RotateCcw, X } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import type { DragOrderConfig } from "@/lib/practice/spec";
import { cn } from "@/lib/utils";

function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function DragOrder({ config }: { config: DragOrderConfig }) {
  if (config.mode === "categorize") return <Categorize config={config} />;
  return <Order config={config} />;
}

function Order({ config }: { config: DragOrderConfig }) {
  const items = config.items ?? [];
  const [arr, setArr] = useState<number[]>(() => {
    const idxs = items.map((_, i) => i);
    let s = shuffle(idxs);
    if (idxs.length > 1 && s.every((v, i) => v === i)) s = [...idxs.slice(1), idxs[0]];
    return s;
  });
  const [submitted, setSubmitted] = useState(false);
  const correct = arr.every((v, i) => v === i);

  function move(pos: number, delta: number) {
    if (submitted) return;
    const t = pos + delta;
    if (t < 0 || t >= arr.length) return;
    setArr((prev) => {
      const n = prev.slice();
      [n[pos], n[t]] = [n[t], n[pos]];
      return n;
    });
  }

  function reset() {
    setArr(shuffle(items.map((_, i) => i)));
    setSubmitted(false);
  }

  return (
    <div className="space-y-3">
      {config.prompt && <p className="text-sm text-muted-foreground">{config.prompt}</p>}
      <div className="space-y-2">
        {arr.map((origIdx, pos) => {
          const ok = submitted && origIdx === pos;
          return (
            <div
              key={origIdx}
              className={cn(
                "flex items-center gap-2 rounded-xl border px-3 py-2.5 text-sm",
                submitted
                  ? ok
                    ? "border-emerald-400 bg-emerald-50"
                    : "border-rose-400 bg-rose-50"
                  : "border-border bg-background",
              )}
            >
              <span className="w-5 text-xs text-muted-foreground">{pos + 1}</span>
              <span className="min-w-0 flex-1">{items[origIdx]}</span>
              {!submitted && (
                <span className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => move(pos, -1)}
                    className="rounded border border-border px-2 hover:bg-secondary"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => move(pos, 1)}
                    className="rounded border border-border px-2 hover:bg-secondary"
                  >
                    ↓
                  </button>
                </span>
              )}
            </div>
          );
        })}
      </div>
      {!submitted ? (
        <Button size="sm" onClick={() => setSubmitted(true)}>
          检查顺序
        </Button>
      ) : (
        <div className="space-y-2">
          <div
            className={cn(
              "flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium",
              correct ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700",
            )}
          >
            {correct ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}
            {correct ? "顺序正确" : "顺序有误，看看正确排列"}
          </div>
          {!correct && (
            <ol className="list-decimal space-y-0.5 rounded-lg bg-muted/50 p-3 pl-7 text-sm">
              {items.map((it, i) => (
                <li key={i}>{it}</li>
              ))}
            </ol>
          )}
          {config.explanation && (
            <p className="rounded-lg bg-muted/50 p-3 text-sm">{config.explanation}</p>
          )}
          <Button size="sm" variant="secondary" onClick={reset}>
            <RotateCcw className="mr-1 h-3.5 w-3.5" />
            重来
          </Button>
        </div>
      )}
    </div>
  );
}

function Categorize({ config }: { config: DragOrderConfig }) {
  const buckets = config.buckets ?? [];
  const cards = config.cards ?? [];
  const [order] = useState(() => shuffle(cards.map((_, i) => i)));
  const [placed, setPlaced] = useState<Record<number, string>>({});
  const [selected, setSelected] = useState<number | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const unplaced = order.filter((i) => !(i in placed));
  const allPlaced = unplaced.length === 0;

  function place(bucketId: string) {
    if (selected == null || submitted) return;
    setPlaced((prev) => ({ ...prev, [selected]: bucketId }));
    setSelected(null);
  }

  function removeCard(i: number) {
    if (submitted) return;
    setPlaced((prev) => {
      const n = { ...prev };
      delete n[i];
      return n;
    });
  }

  function reset() {
    setPlaced({});
    setSelected(null);
    setSubmitted(false);
  }

  const correctCount = cards.filter((c, i) => placed[i] === c.bucket).length;

  return (
    <div className="space-y-3">
      {config.prompt && <p className="text-sm text-muted-foreground">{config.prompt}</p>}

      {/* 待归类 */}
      <div className="flex flex-wrap gap-2 rounded-xl border border-dashed border-border bg-muted/30 p-3 min-h-[52px]">
        {unplaced.length === 0 && (
          <span className="text-xs text-muted-foreground">全部已归类</span>
        )}
        {unplaced.map((i) => (
          <button
            key={i}
            type="button"
            onClick={() => setSelected((s) => (s === i ? null : i))}
            className={cn(
              "rounded-lg border px-3 py-1.5 text-sm transition",
              selected === i
                ? "border-primary bg-primary/10"
                : "border-border bg-background hover:bg-secondary",
            )}
          >
            {cards[i].text}
          </button>
        ))}
      </div>

      {/* 分桶 */}
      <div className="grid gap-2 sm:grid-cols-2">
        {buckets.map((b) => {
          const inBucket = cards
            .map((c, i) => ({ c, i }))
            .filter(({ i }) => placed[i] === b.id);
          return (
            <button
              key={b.id}
              type="button"
              onClick={() => place(b.id)}
              className={cn(
                "min-h-[80px] rounded-xl border p-3 text-left transition",
                selected != null
                  ? "border-primary/60 bg-primary/5"
                  : "border-border bg-background",
              )}
            >
              <div className="mb-2 text-xs font-semibold text-muted-foreground">
                {b.label}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {inBucket.map(({ c, i }) => {
                  const ok = submitted && c.bucket === b.id;
                  const bad = submitted && c.bucket !== b.id;
                  return (
                    <span
                      key={i}
                      onClick={(e) => {
                        e.stopPropagation();
                        removeCard(i);
                      }}
                      className={cn(
                        "rounded-md border px-2 py-1 text-xs",
                        ok
                          ? "border-emerald-400 bg-emerald-50 text-emerald-700"
                          : bad
                            ? "border-rose-400 bg-rose-50 text-rose-700"
                            : "border-border bg-secondary",
                      )}
                    >
                      {c.text}
                    </span>
                  );
                })}
              </div>
            </button>
          );
        })}
      </div>

      {!submitted ? (
        <Button size="sm" disabled={!allPlaced} onClick={() => setSubmitted(true)}>
          {allPlaced ? "检查" : "先把条目都归类"}
        </Button>
      ) : (
        <div className="space-y-2">
          <div
            className={cn(
              "rounded-lg px-3 py-2 text-sm font-medium",
              correctCount === cards.length
                ? "bg-emerald-50 text-emerald-700"
                : "bg-amber-50 text-amber-700",
            )}
          >
            正确 {correctCount}/{cards.length}
          </div>
          <Button size="sm" variant="secondary" onClick={reset}>
            <RotateCcw className="mr-1 h-3.5 w-3.5" />
            重来
          </Button>
        </div>
      )}
    </div>
  );
}
