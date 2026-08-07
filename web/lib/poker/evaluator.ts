// 7 张选 5 的最优牌型评估 + 蒙特卡洛胜率。纯计算，客户端运行。
import { cardId, fullDeck, type PlayingCard, shuffle } from "./cards";

/**
 * 把 5 张牌评成一个可比较的分数数组：[category, ...tiebreakers]。
 * category: 8=同花顺 7=四条 6=葫芦 5=同花 4=顺子 3=三条 2=两对 1=一对 0=高牌
 * 数组按字典序比较，越大越好。
 */
function eval5(cards: PlayingCard[]): number[] {
  const ranks = cards.map((c) => c.rank).sort((a, b) => b - a);
  const suits = cards.map((c) => c.suit);
  const isFlush = suits.every((s) => s === suits[0]);

  const uniq = Array.from(new Set(ranks)).sort((a, b) => b - a);
  let straightHigh = 0;
  if (uniq.length === 5) {
    if (uniq[0] - uniq[4] === 4) straightHigh = uniq[0];
    else if (uniq[0] === 14 && uniq[1] === 5 && uniq[4] === 2) straightHigh = 5; // A-2-3-4-5
  }

  const countMap = new Map<number, number>();
  for (const r of ranks) countMap.set(r, (countMap.get(r) ?? 0) + 1);
  // 先按数量降序，数量相同按点数降序
  const groups = [...countMap.entries()].sort(
    (a, b) => b[1] - a[1] || b[0] - a[0],
  );
  const counts = groups.map((g) => g[1]);
  const byRank = groups.map((g) => g[0]);

  const isStraight = straightHigh > 0;

  if (isStraight && isFlush) return [8, straightHigh];
  if (counts[0] === 4) return [7, byRank[0], byRank[1]];
  if (counts[0] === 3 && counts[1] === 2) return [6, byRank[0], byRank[1]];
  if (isFlush) return [5, ...ranks];
  if (isStraight) return [4, straightHigh];
  if (counts[0] === 3) return [3, byRank[0], byRank[1], byRank[2]];
  if (counts[0] === 2 && counts[1] === 2) return [2, byRank[0], byRank[1], byRank[2]];
  if (counts[0] === 2) return [1, byRank[0], byRank[1], byRank[2], byRank[3]];
  return [0, ...ranks];
}

export function compareScore(a: number[], b: number[]): number {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x - y;
  }
  return 0;
}

// C(7,5) 的 21 种 5 张组合下标
const COMBOS_7_5: number[][] = (() => {
  const res: number[][] = [];
  for (let a = 0; a < 7; a++)
    for (let b = a + 1; b < 7; b++)
      for (let c = b + 1; c < 7; c++)
        for (let d = c + 1; d < 7; d++)
          for (let e = d + 1; e < 7; e++) res.push([a, b, c, d, e]);
  return res;
})();

/** 7 张里取最优 5 张的分数 */
export function evaluate7(cards: PlayingCard[]): number[] {
  let best: number[] | null = null;
  for (const combo of COMBOS_7_5) {
    const hand = [cards[combo[0]], cards[combo[1]], cards[combo[2]], cards[combo[3]], cards[combo[4]]];
    const score = eval5(hand);
    if (best === null || compareScore(score, best) > 0) best = score;
  }
  return best as number[];
}

export interface EquityResult {
  win: number; // 0..1
  tie: number;
  lose: number;
  iterations: number;
}

/**
 * 蒙特卡洛估算 hero 对 1 名对手的胜率。
 * villain 为 null 表示对手随机手牌；board 可为 0~5 张。
 */
export function equityMonteCarlo(
  hero: PlayingCard[],
  board: PlayingCard[],
  opts: { villain?: PlayingCard[] | null; iterations?: number } = {},
): EquityResult {
  const iterations = opts.iterations ?? 3000;
  const villain = opts.villain ?? null;

  const used = new Set(
    [...hero, ...board, ...(villain ?? [])].map(cardId),
  );
  const baseDeck = fullDeck().filter((c) => !used.has(cardId(c)));

  const needBoard = 5 - board.length;

  let win = 0;
  let tie = 0;
  let lose = 0;

  for (let it = 0; it < iterations; it++) {
    const drawn = shuffle(baseDeck);
    let idx = 0;
    const villHole = villain ?? [drawn[idx++], drawn[idx++]];
    const extraBoard: PlayingCard[] = [];
    for (let k = 0; k < needBoard; k++) extraBoard.push(drawn[idx++]);
    const fullBoard = [...board, ...extraBoard];

    const heroScore = evaluate7([...hero, ...fullBoard]);
    const villScore = evaluate7([...villHole, ...fullBoard]);
    const cmp = compareScore(heroScore, villScore);
    if (cmp > 0) win++;
    else if (cmp < 0) lose++;
    else tie++;
  }

  return {
    win: win / iterations,
    tie: tie / iterations,
    lose: lose / iterations,
    iterations,
  };
}
