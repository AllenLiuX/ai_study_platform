"use client";

import { create } from "zustand";

import { cardId, fullDeck, type PlayingCard, shuffle } from "./cards";

export type FillTarget = "hero" | "board" | "villain";

interface PokerState {
  hero: PlayingCard[]; // 0..2
  board: PlayingCard[]; // 0..5
  villain: PlayingCard[]; // 0..2 指定对手手牌（空=不指定）
  /** 点牌堆时新牌加到哪一区 */
  fillTarget: FillTarget;
  setFillTarget: (t: FillTarget) => void;
  /** 已在任一区则移除；否则加到当前 fillTarget 的下一个空位 */
  toggleCard: (card: PlayingCard) => void;
  clearCard: (card: PlayingCard) => void;
  dealRandom: () => void;
  /** 发下一街公共牌（翻牌后逐张：转牌 / 河牌） */
  dealNext: () => void;
  reset: () => void;
}

const CAP: Record<FillTarget, number> = { hero: 2, board: 5, villain: 2 };

function has(list: PlayingCard[], card: PlayingCard): boolean {
  const id = cardId(card);
  return list.some((c) => cardId(c) === id);
}

function remove(list: PlayingCard[], card: PlayingCard): PlayingCard[] {
  return list.filter((c) => cardId(c) !== cardId(card));
}

export const usePokerStore = create<PokerState>((set) => ({
  hero: [],
  board: [],
  villain: [],
  fillTarget: "hero",
  setFillTarget: (t) => set({ fillTarget: t }),
  toggleCard: (card) =>
    set((state) => {
      if (has(state.hero, card)) return { hero: remove(state.hero, card) };
      if (has(state.board, card)) return { board: remove(state.board, card) };
      if (has(state.villain, card)) return { villain: remove(state.villain, card) };

      const target = state.fillTarget;
      if (state[target].length >= CAP[target]) return {};
      return { [target]: [...state[target], card] } as Partial<PokerState>;
    }),
  clearCard: (card) =>
    set((state) => ({
      hero: remove(state.hero, card),
      board: remove(state.board, card),
      villain: remove(state.villain, card),
    })),
  dealRandom: () =>
    set(() => {
      const deck = shuffle(fullDeck());
      return {
        hero: [deck[0], deck[1]],
        board: [deck[2], deck[3], deck[4]], // 发到翻牌
        villain: [],
      };
    }),
  dealNext: () =>
    set((state) => {
      if (state.hero.length < 2 || state.board.length >= 5) return {};
      const used = new Set(
        [...state.hero, ...state.board, ...state.villain].map(cardId),
      );
      const remaining = fullDeck().filter((c) => !used.has(cardId(c)));
      const next = shuffle(remaining)[0];
      if (!next) return {};
      return { board: [...state.board, next] };
    }),
  reset: () => set({ hero: [], board: [], villain: [], fillTarget: "hero" }),
}));
