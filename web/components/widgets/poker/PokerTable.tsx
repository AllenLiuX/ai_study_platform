"use client";

import { Play, Shuffle, Trash2 } from "lucide-react";
import { useMemo } from "react";

import { Button } from "@/components/ui/button";
import { cardId } from "@/lib/poker/cards";
import { evaluateBest, handCategoryName } from "@/lib/poker/evaluator";
import { usePokerStore } from "@/lib/poker/store";

import { PlayingCardView } from "./PlayingCardView";

const STREET_LABEL = ["翻牌前", "翻牌前", "翻牌前", "翻牌", "转牌", "河牌"];

/** 牌桌 widget：展示手牌 + 公共牌，随机发牌 + 逐街发牌，实时显示牌型。 */
export function PokerTable() {
  const hero = usePokerStore((s) => s.hero);
  const board = usePokerStore((s) => s.board);
  const dealRandom = usePokerStore((s) => s.dealRandom);
  const dealNext = usePokerStore((s) => s.dealNext);
  const reset = usePokerStore((s) => s.reset);

  const boardSlots = Array.from({ length: 5 }, (_, i) => board[i] ?? null);
  const heroSlots = Array.from({ length: 2 }, (_, i) => hero[i] ?? null);

  const handName = useMemo(() => {
    if (hero.length !== 2 || board.length < 3) return "";
    return handCategoryName(evaluateBest([...hero, ...board]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hero.map(cardId).join(","), board.map(cardId).join(",")]);

  const street = STREET_LABEL[board.length] ?? "河牌";
  const canDealNext = hero.length === 2 && board.length >= 3 && board.length < 5;

  return (
    <div className="rounded-3xl border border-border bg-card p-5 shadow-card">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold tracking-tight">牌桌</h3>
          {hero.length === 2 && (
            <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium text-secondary-foreground">
              {street}
            </span>
          )}
        </div>
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

      <div className="mt-4 flex items-center justify-between gap-3">
        <div className="text-sm">
          {handName ? (
            <span className="text-muted-foreground">
              当前牌型：
              <span className="font-semibold text-foreground">{handName}</span>
            </span>
          ) : (
            <span className="text-muted-foreground">
              发牌后这里显示你的成手牌型
            </span>
          )}
        </div>
        <Button
          size="sm"
          variant="secondary"
          onClick={dealNext}
          disabled={!canDealNext}
        >
          <Play className="mr-1 h-3.5 w-3.5" />
          {board.length === 3 ? "发转牌" : board.length === 4 ? "发河牌" : "发下一张"}
        </Button>
      </div>
    </div>
  );
}
