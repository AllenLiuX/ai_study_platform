"use client";

import { Loader2, Shuffle } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { cardId, type PlayingCard, RANKS, SUITS } from "@/lib/poker/cards";
import { equityMonteCarlo, type EquityResult } from "@/lib/poker/evaluator";
import { usePokerStore } from "@/lib/poker/store";
import { cn } from "@/lib/utils";

import { PlayingCardView } from "./PlayingCardView";

const ITER_OPTIONS = [1000, 3000, 10000];

export function EquityCalculator() {
  const hero = usePokerStore((s) => s.hero);
  const board = usePokerStore((s) => s.board);
  const toggleCard = usePokerStore((s) => s.toggleCard);
  const clearCard = usePokerStore((s) => s.clearCard);
  const dealRandom = usePokerStore((s) => s.dealRandom);

  const [iterations, setIterations] = useState(3000);
  const [result, setResult] = useState<EquityResult | null>(null);
  const [computing, setComputing] = useState(false);
  const tokenRef = useRef(0);

  const used = new Set([...hero, ...board].map(cardId));
  const ready = hero.length === 2;

  useEffect(() => {
    if (!ready) {
      setResult(null);
      return;
    }
    const token = ++tokenRef.current;
    setComputing(true);
    // 让出主线程，避免大迭代阻塞渲染
    const timer = setTimeout(() => {
      const res = equityMonteCarlo(hero, board, { iterations });
      if (tokenRef.current === token) {
        setResult(res);
        setComputing(false);
      }
    }, 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    ready,
    iterations,
    hero.map(cardId).join(","),
    board.map(cardId).join(","),
  ]);

  const heroSlots = Array.from({ length: 2 }, (_, i) => hero[i] ?? null);
  const boardSlots = Array.from({ length: 5 }, (_, i) => board[i] ?? null);

  return (
    <div className="rounded-3xl border border-border bg-card p-5 shadow-card">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold tracking-tight">胜率计算器</h3>
        <span className="text-xs text-muted-foreground">对手：随机手牌</span>
      </div>

      {/* 当前选择 */}
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <div className="mb-1 text-[11px] text-muted-foreground">手牌</div>
          <div className="flex gap-1.5">
            {heroSlots.map((c, i) => (
              <PlayingCardView
                key={`h${i}`}
                card={c}
                size="sm"
                onClick={c ? () => clearCard(c) : undefined}
              />
            ))}
          </div>
        </div>
        <div>
          <div className="mb-1 text-[11px] text-muted-foreground">公共牌</div>
          <div className="flex gap-1.5">
            {boardSlots.map((c, i) => (
              <PlayingCardView
                key={`b${i}`}
                card={c}
                size="sm"
                onClick={c ? () => clearCard(c) : undefined}
              />
            ))}
          </div>
        </div>
        <Button size="sm" variant="secondary" onClick={dealRandom}>
          <Shuffle className="mr-1 h-3.5 w-3.5" />
          随机
        </Button>
      </div>

      {/* 结果 */}
      <div className="my-4">
        {!ready ? (
          <p className="rounded-xl bg-muted/50 px-3 py-4 text-center text-sm text-muted-foreground">
            从下方牌堆选 2 张作为你的手牌，即可估算胜率
          </p>
        ) : (
          <EquityBars result={result} computing={computing} />
        )}
      </div>

      {/* 迭代次数 */}
      <div className="mb-4 flex items-center gap-2 text-xs">
        <span className="text-muted-foreground">模拟次数</span>
        {ITER_OPTIONS.map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => setIterations(n)}
            className={cn(
              "rounded-full border px-2.5 py-1 transition",
              n === iterations
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:bg-secondary",
            )}
          >
            {n.toLocaleString()}
          </button>
        ))}
      </div>

      {/* 牌堆 */}
      <CardPalette used={used} onPick={toggleCard} />
    </div>
  );
}

function EquityBars({
  result,
  computing,
}: {
  result: EquityResult | null;
  computing: boolean;
}) {
  const win = result ? Math.round(result.win * 1000) / 10 : 0;
  const tie = result ? Math.round(result.tie * 1000) / 10 : 0;
  const lose = result ? Math.round(result.lose * 1000) / 10 : 0;
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <span className="text-sm text-muted-foreground">胜率（含平分）</span>
        <span className="flex items-center gap-1.5 text-2xl font-semibold tracking-tight">
          {computing && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          {result ? `${(win + tie / 2).toFixed(1)}%` : "—"}
        </span>
      </div>
      <div className="flex h-3 overflow-hidden rounded-full bg-secondary">
        <div className="h-full bg-primary" style={{ width: `${win}%` }} />
        <div className="h-full bg-amber-400" style={{ width: `${tie}%` }} />
        <div className="h-full bg-rose-400" style={{ width: `${lose}%` }} />
      </div>
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>胜 {win}%</span>
        <span>平 {tie}%</span>
        <span>负 {lose}%</span>
      </div>
    </div>
  );
}

function CardPalette({
  used,
  onPick,
}: {
  used: Set<string>;
  onPick: (card: PlayingCard) => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="text-[11px] text-muted-foreground">牌堆（点击加入 / 移除）</div>
      {SUITS.map((suit) => (
        <div key={suit} className="flex flex-wrap gap-1">
          {RANKS.map((rank) => {
            const card: PlayingCard = { rank, suit };
            const isUsed = used.has(cardId(card));
            return (
              <PlayingCardView
                key={cardId(card)}
                card={card}
                size="sm"
                faded={isUsed}
                onClick={() => onPick(card)}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}
