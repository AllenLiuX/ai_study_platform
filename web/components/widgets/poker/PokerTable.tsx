"use client";

import { Shuffle, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { usePokerStore } from "@/lib/poker/store";

import { PlayingCardView } from "./PlayingCardView";

/** 牌桌 widget：展示手牌 + 公共牌，并可随机发牌。 */
export function PokerTable() {
  const hero = usePokerStore((s) => s.hero);
  const board = usePokerStore((s) => s.board);
  const dealRandom = usePokerStore((s) => s.dealRandom);
  const reset = usePokerStore((s) => s.reset);

  const boardSlots = Array.from({ length: 5 }, (_, i) => board[i] ?? null);
  const heroSlots = Array.from({ length: 2 }, (_, i) => hero[i] ?? null);

  return (
    <div className="rounded-3xl border border-border bg-card p-5 shadow-card">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold tracking-tight">牌桌</h3>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={dealRandom}>
            <Shuffle className="mr-1 h-3.5 w-3.5" />
            随机发牌
          </Button>
          <Button size="sm" variant="ghost" onClick={reset}>
            <Trash2 className="mr-1 h-3.5 w-3.5" />
            清空
          </Button>
        </div>
      </div>

      {/* 牌桌绿呢 */}
      <div className="rounded-3xl border border-emerald-900/20 bg-emerald-800/90 p-6">
        <div className="mb-2 text-center text-[11px] uppercase tracking-widest text-emerald-100/70">
          公共牌
        </div>
        <div className="flex justify-center gap-2">
          {boardSlots.map((c, i) => (
            <PlayingCardView key={`b${i}`} card={c} size="md" />
          ))}
        </div>

        <div className="mx-auto my-5 h-px w-2/3 bg-emerald-100/15" />

        <div className="mb-2 text-center text-[11px] uppercase tracking-widest text-emerald-100/70">
          你的手牌
        </div>
        <div className="flex justify-center gap-2">
          {heroSlots.map((c, i) => (
            <PlayingCardView key={`h${i}`} card={c} size="lg" />
          ))}
        </div>
      </div>
    </div>
  );
}
