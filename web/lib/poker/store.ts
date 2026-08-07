"use client";

import { create } from "zustand";

import { cardId, fullDeck, type PlayingCard, shuffle } from "./cards";

interface PokerState {
  hero: PlayingCard[]; // 0..2
  board: PlayingCard[]; // 0..5
  villain: PlayingCard[] | null; // null = 随机对手
  /** 把一张牌加到下一个空位（先手牌后公共牌）；已存在则移除 */
  toggleCard: (card: PlayingCard) => void;
  clearCard: (card: PlayingCard) => void;
  dealRandom: () => void;
  reset: () => void;
}

function has(list: PlayingCard[], card: PlayingCard): boolean {
  const id = cardId(card);
  return list.some((c) => cardId(c) === id);
}

export const usePokerStore = create<PokerState>((set) => ({
  hero: [],
  board: [],
  villain: null,
  toggleCard: (card) =>
    set((state) => {
      // 已在手牌/公共牌里 → 移除
      if (has(state.hero, card)) {
        return { hero: state.hero.filter((c) => cardId(c) !== cardId(card)) };
      }
      if (has(state.board, card)) {
        return { board: state.board.filter((c) => cardId(c) !== cardId(card)) };
      }
      // 否则填到下一个空位：先手牌(2)再公共牌(5)
      if (state.hero.length < 2) return { hero: [...state.hero, card] };
      if (state.board.length < 5) return { board: [...state.board, card] };
      return {};
    }),
  clearCard: (card) =>
    set((state) => ({
      hero: state.hero.filter((c) => cardId(c) !== cardId(card)),
      board: state.board.filter((c) => cardId(c) !== cardId(card)),
    })),
  dealRandom: () =>
    set(() => {
      const deck = shuffle(fullDeck());
      return {
        hero: [deck[0], deck[1]],
        board: [deck[2], deck[3], deck[4]], // 发到翻牌
        villain: null,
      };
    }),
  reset: () => set({ hero: [], board: [], villain: null }),
}));
