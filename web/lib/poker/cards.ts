// 德州扑克基础牌型工具 — 无第三方依赖，纯前端可运行。

export type Suit = "s" | "h" | "d" | "c";

/** rank: 2..14 (11=J, 12=Q, 13=K, 14=A) */
export interface PlayingCard {
  rank: number;
  suit: Suit;
}

export const SUITS: Suit[] = ["s", "h", "d", "c"];

/** 从高到低 */
export const RANKS: number[] = [14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2];

export const RANK_LABEL: Record<number, string> = {
  14: "A",
  13: "K",
  12: "Q",
  11: "J",
  10: "T",
  9: "9",
  8: "8",
  7: "7",
  6: "6",
  5: "5",
  4: "4",
  3: "3",
  2: "2",
};

export const SUIT_LABEL: Record<Suit, string> = {
  s: "\u2660", // ♠
  h: "\u2665", // ♥
  d: "\u2666", // ♦
  c: "\u2663", // ♣
};

/** 红色花色（红桃/方块），用于渲染配色 */
export function isRedSuit(suit: Suit): boolean {
  return suit === "h" || suit === "d";
}

export function cardId(card: PlayingCard): string {
  return `${card.rank}${card.suit}`;
}

export function cardLabel(card: PlayingCard): string {
  return `${RANK_LABEL[card.rank]}${SUIT_LABEL[card.suit]}`;
}

export function fullDeck(): PlayingCard[] {
  const deck: PlayingCard[] = [];
  for (const rank of RANKS) {
    for (const suit of SUITS) {
      deck.push({ rank, suit });
    }
  }
  return deck;
}

/** Fisher–Yates 洗牌（返回新数组） */
export function shuffle<T>(input: T[]): T[] {
  const arr = input.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
