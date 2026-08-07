"use client";

import {
  isRedSuit,
  type PlayingCard,
  RANK_LABEL,
  SUIT_LABEL,
} from "@/lib/poker/cards";
import { cn } from "@/lib/utils";

const SIZES = {
  sm: "h-10 w-7 text-xs rounded-md",
  md: "h-16 w-11 text-lg rounded-lg",
  lg: "h-20 w-14 text-xl rounded-lg",
} as const;

export function PlayingCardView({
  card,
  size = "md",
  className,
  onClick,
  faded,
}: {
  card?: PlayingCard | null;
  size?: keyof typeof SIZES;
  className?: string;
  onClick?: () => void;
  faded?: boolean;
}) {
  if (!card) {
    return (
      <div
        onClick={onClick}
        className={cn(
          "flex items-center justify-center border border-dashed border-border bg-muted/40 text-muted-foreground",
          SIZES[size],
          onClick && "cursor-pointer",
          className,
        )}
      >
        <span className="text-[10px]">?</span>
      </div>
    );
  }
  const red = isRedSuit(card.suit);
  return (
    <div
      onClick={onClick}
      className={cn(
        "flex flex-col items-center justify-center border border-border bg-white font-semibold leading-none shadow-card",
        SIZES[size],
        red ? "text-rose-600" : "text-slate-900",
        onClick && "cursor-pointer transition hover:-translate-y-0.5",
        faded && "opacity-30",
        className,
      )}
    >
      <span>{RANK_LABEL[card.rank]}</span>
      <span className="text-[0.9em]">{SUIT_LABEL[card.suit]}</span>
    </div>
  );
}
