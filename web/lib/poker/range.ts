// 起手范围工具：13×13 网格坐标 ↔ 手牌标签 ↔ 具体两张牌组合。纯前端。
import { type PlayingCard, RANK_LABEL, SUITS } from "./cards";

export const IDX = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
export const TOTAL_COMBOS = 1326;

/** 网格下标 → 点数（0=A=14 … 12=2）。 */
export function rankAt(i: number): number {
  return 14 - i;
}

export function comboKey(i: number, j: number): string {
  return `${i}-${j}`;
}

export function comboLabel(i: number, j: number): string {
  const hi = RANK_LABEL[rankAt(Math.min(i, j))];
  const lo = RANK_LABEL[rankAt(Math.max(i, j))];
  if (i === j) return RANK_LABEL[rankAt(i)] + RANK_LABEL[rankAt(i)];
  return i < j ? `${hi}${lo}s` : `${hi}${lo}o`;
}

/** 该格代表的组合数：口袋对 6，同花 4，非同花 12。 */
export function comboWeight(i: number, j: number): number {
  if (i === j) return 6;
  return i < j ? 4 : 12;
}

export type Preset = "clear" | "all" | "tight" | "wide";

export const PRESET_LABEL: Record<Exclude<Preset, "clear">, string> = {
  tight: "紧",
  wide: "宽",
  all: "全部",
};

export function buildPreset(preset: Preset): Set<string> {
  const set = new Set<string>();
  if (preset === "clear") return set;
  for (const i of IDX) {
    for (const j of IDX) {
      const hi = rankAt(Math.min(i, j));
      const lo = rankAt(Math.max(i, j));
      const isPair = i === j;
      const isSuited = i < j;
      let take = false;
      if (preset === "all") take = true;
      else if (preset === "tight") {
        if (isPair && rankAt(i) >= 10) take = true; // TT+
        else if (isSuited && hi === 14 && lo >= 12) take = true; // AKs, AQs
        else if (!isPair && !isSuited && hi === 14 && lo === 13) take = true; // AKo
      } else if (preset === "wide") {
        if (isPair) take = true;
        else if (isSuited) take = true;
        else if (hi >= 10 && lo >= 10) take = true;
      }
      if (take) set.add(comboKey(i, j));
    }
  }
  return set;
}

/** 把一个格子展开为所有具体的两张牌组合。 */
export function expandCombo(i: number, j: number): PlayingCard[][] {
  const out: PlayingCard[][] = [];
  if (i === j) {
    const r = rankAt(i);
    for (let a = 0; a < SUITS.length; a++) {
      for (let b = a + 1; b < SUITS.length; b++) {
        out.push([
          { rank: r, suit: SUITS[a] },
          { rank: r, suit: SUITS[b] },
        ]);
      }
    }
    return out;
  }
  const hiRank = rankAt(Math.min(i, j));
  const loRank = rankAt(Math.max(i, j));
  if (i < j) {
    // 同花：两张同一花色
    for (const s of SUITS) {
      out.push([
        { rank: hiRank, suit: s },
        { rank: loRank, suit: s },
      ]);
    }
  } else {
    // 非同花：花色不同
    for (const s1 of SUITS) {
      for (const s2 of SUITS) {
        if (s1 !== s2) {
          out.push([
            { rank: hiRank, suit: s1 },
            { rank: loRank, suit: s2 },
          ]);
        }
      }
    }
  }
  return out;
}

/** 把一整个范围（格子集合）展开为所有具体组合。 */
export function expandRange(selected: Set<string>): PlayingCard[][] {
  const out: PlayingCard[][] = [];
  for (const k of selected) {
    const [i, j] = k.split("-").map(Number);
    out.push(...expandCombo(i, j));
  }
  return out;
}
