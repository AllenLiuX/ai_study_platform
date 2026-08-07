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

const HAND_CATEGORY_NAMES = [
  "高牌",
  "一对",
  "两对",
  "三条",
  "顺子",
  "同花",
  "葫芦",
  "四条",
  "同花顺",
];

/** 由分数数组得到中文牌型名（含皇家同花顺）。 */
export function handCategoryName(score: number[] | null): string {
  if (!score) return "";
  const cat = score[0];
  if (cat === 8 && score[1] === 14) return "皇家同花顺";
  return HAND_CATEGORY_NAMES[cat] ?? "";
}

// 生成 C(n,5) 的下标组合（n 为 5~7），带缓存。
const COMBO_CACHE = new Map<number, number[][]>();
function combos5(n: number): number[][] {
  const cached = COMBO_CACHE.get(n);
  if (cached) return cached;
  const res: number[][] = [];
  for (let a = 0; a < n; a++)
    for (let b = a + 1; b < n; b++)
      for (let c = b + 1; c < n; c++)
        for (let d = c + 1; d < n; d++)
          for (let e = d + 1; e < n; e++) res.push([a, b, c, d, e]);
  COMBO_CACHE.set(n, res);
  return res;
}

/** 任意 5~7 张牌里取最优 5 张的分数；不足 5 张返回 null。 */
export function evaluateBest(cards: PlayingCard[]): number[] | null {
  if (cards.length < 5) return null;
  if (cards.length === 5) return eval5(cards);
  let best: number[] | null = null;
  for (const combo of combos5(cards.length)) {
    const hand = combo.map((i) => cards[i]);
    const score = eval5(hand);
    if (best === null || compareScore(score, best) > 0) best = score;
  }
  return best;
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

export interface EquityOptions {
  /** 指定单个对手的两张手牌（优先级最高） */
  villain?: PlayingCard[] | null;
  /** 对手可能手牌的组合池（用于「对手范围」，每次迭代随机抽一手） */
  villainRange?: PlayingCard[][] | null;
  /** 随机对手数量（仅在未指定手牌/范围时生效） */
  opponents?: number;
  iterations?: number;
}

/**
 * 蒙特卡洛估算 hero 对手的胜率，支持：
 * - 随机对手（可多名 opponents）
 * - 指定对手手牌 villain
 * - 对手范围 villainRange（组合池，随机抽样）
 * hero 需胜过所有对手才算「胜」；与最强对手并列则算「平（分池）」。
 */
export function equityMonteCarlo(
  hero: PlayingCard[],
  board: PlayingCard[],
  opts: EquityOptions = {},
): EquityResult {
  const iterations = opts.iterations ?? 3000;
  const villain = opts.villain && opts.villain.length === 2 ? opts.villain : null;
  const opponents = Math.max(1, opts.opponents ?? 1);

  const heroBoardUsed = new Set([...hero, ...board].map(cardId));

  // 预筛范围：去掉与 hero/已知公共牌冲突的组合
  let validRange: PlayingCard[][] | null = null;
  if (!villain && opts.villainRange && opts.villainRange.length) {
    validRange = opts.villainRange.filter((combo) =>
      combo.every((c) => !heroBoardUsed.has(cardId(c))),
    );
    if (validRange.length === 0) validRange = null;
  }

  const needBoard = 5 - board.length;
  // 指定手牌或范围时对手固定为 1 名，否则用随机对手人数
  const oppCount = villain || validRange ? 1 : opponents;

  let win = 0;
  let tie = 0;
  let lose = 0;

  for (let it = 0; it < iterations; it++) {
    const usedThis = new Set(heroBoardUsed);
    const villainHands: PlayingCard[][] = [];

    if (villain) {
      villainHands.push(villain);
      for (const c of villain) usedThis.add(cardId(c));
    } else if (validRange) {
      let chosen: PlayingCard[] | null = null;
      for (let t = 0; t < 12; t++) {
        const cand = validRange[(Math.random() * validRange.length) | 0];
        if (cand.every((c) => !usedThis.has(cardId(c)))) {
          chosen = cand;
          break;
        }
      }
      if (chosen) {
        villainHands.push(chosen);
        for (const c of chosen) usedThis.add(cardId(c));
      }
    }

    const deck = shuffle(fullDeck().filter((c) => !usedThis.has(cardId(c))));
    let idx = 0;
    while (villainHands.length < oppCount) {
      villainHands.push([deck[idx++], deck[idx++]]);
    }

    const extraBoard: PlayingCard[] = [];
    for (let k = 0; k < needBoard; k++) extraBoard.push(deck[idx++]);
    const fullBoard = [...board, ...extraBoard];

    const heroScore = evaluate7([...hero, ...fullBoard]);
    let heroLoses = false;
    let heroTies = false;
    for (const vh of villainHands) {
      const cmp = compareScore(heroScore, evaluate7([...vh, ...fullBoard]));
      if (cmp < 0) {
        heroLoses = true;
        break;
      }
      if (cmp === 0) heroTies = true;
    }
    if (heroLoses) lose++;
    else if (heroTies) tie++;
    else win++;
  }

  return {
    win: win / iterations,
    tie: tie / iterations,
    lose: lose / iterations,
    iterations,
  };
}
