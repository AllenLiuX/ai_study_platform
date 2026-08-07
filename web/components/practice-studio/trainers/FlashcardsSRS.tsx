"use client";

import { RotateCcw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import type { FlashcardsSrsConfig } from "@/lib/practice/spec";
import { cn } from "@/lib/utils";

interface Sched {
  interval: number; // 天
  ease: number;
  due: number; // 到期序号（相对会话，简化为轮次）
}

type Rating = "again" | "good" | "easy";

export function FlashcardsSRS({
  config,
  storageKey,
}: {
  config: FlashcardsSrsConfig;
  storageKey?: string;
}) {
  const key = storageKey ? `srs-${storageKey}` : null;
  const [sched, setSched] = useState<Record<number, Sched>>({});
  const [flipped, setFlipped] = useState(false);
  const [round, setRound] = useState(0);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (key) {
      try {
        const raw = localStorage.getItem(key);
        if (raw) setSched(JSON.parse(raw));
      } catch {
        /* ignore */
      }
    }
    setLoaded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  function persist(next: Record<number, Sched>) {
    setSched(next);
    if (key) localStorage.setItem(key, JSON.stringify(next));
  }

  // 到期队列：due <= round 的卡；新卡（无记录）视为立即到期。
  const dueQueue = useMemo(() => {
    if (!loaded) return [];
    return config.cards
      .map((_, i) => i)
      .filter((i) => !sched[i] || sched[i].due <= round);
  }, [config.cards, sched, round, loaded]);

  const currentIdx = dueQueue[0];
  const card = currentIdx != null ? config.cards[currentIdx] : null;

  const total = config.cards.length;
  const learned = config.cards.filter(
    (_, i) => sched[i] && sched[i].interval >= 4,
  ).length;

  function rate(r: Rating) {
    if (currentIdx == null) return;
    const prev = sched[currentIdx] ?? { interval: 0, ease: 2.3, due: round };
    let interval = prev.interval;
    let ease = prev.ease;
    if (r === "again") {
      interval = 0;
      ease = Math.max(1.3, ease - 0.2);
    } else if (r === "good") {
      interval = interval === 0 ? 1 : Math.round(interval * ease);
      ease = ease;
    } else {
      interval = interval === 0 ? 2 : Math.round(interval * ease * 1.3);
      ease = ease + 0.1;
    }
    const nextDue = round + Math.max(1, interval);
    persist({ ...sched, [currentIdx]: { interval, ease, due: nextDue } });
    setFlipped(false);
    setRound((x) => x + 1);
  }

  function resetAll() {
    persist({});
    setRound(0);
    setFlipped(false);
  }

  if (!loaded) return <div className="h-40" />;

  if (!card) {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-center">
        <div className="text-sm font-semibold text-emerald-800">
          本轮到期卡片已复习完 🎉
        </div>
        <div className="mt-1 text-xs text-emerald-700">
          已掌握 {learned}/{total}
        </div>
        <Button className="mt-4" variant="secondary" size="sm" onClick={resetAll}>
          <RotateCcw className="mr-1 h-3.5 w-3.5" />
          重置进度
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>本轮待复习 {dueQueue.length}</span>
        <span>已掌握 {learned}/{total}</span>
      </div>
      <button
        type="button"
        onClick={() => setFlipped((f) => !f)}
        className="flex min-h-[160px] w-full flex-col items-center justify-center rounded-2xl border border-border bg-background/60 p-6 text-center transition hover:bg-secondary/40"
      >
        <div className="text-lg font-semibold">{card.front}</div>
        {flipped ? (
          <div className="mt-3 border-t border-border pt-3 text-base">{card.back}</div>
        ) : (
          <div className="mt-3 text-[11px] text-muted-foreground">点击看答案</div>
        )}
      </button>
      {flipped && (
        <div className="grid grid-cols-3 gap-2">
          <Button variant="outline" onClick={() => rate("again")}>
            忘记了
          </Button>
          <Button variant="secondary" onClick={() => rate("good")}>
            记得
          </Button>
          <Button onClick={() => rate("easy")}>很简单</Button>
        </div>
      )}
    </div>
  );
}
