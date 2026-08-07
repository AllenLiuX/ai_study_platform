"use client";

import dynamic from "next/dynamic";
import type { ComponentType } from "react";

/**
 * Widget 注册表（编排层）。
 *
 * 每个学习交互能力封装成一个独立 widget，用 next/dynamic 懒加载 —— 只有真正被
 * 组装到页面时才拉取对应代码，避免包体膨胀。学习规划节点未来只需声明 widget 类型，
 * WidgetRenderer 就能按需渲染。
 */

export type WidgetType =
  | "poker.table"
  | "poker.equity"
  | "poker.range"
  | "japanese.kana"
  | "japanese.flashcards"
  | "quant.backtest"
  | "quant.kelly"
  | "commerce.funnel"
  | "commerce.script"
  | "chinese.dictation"
  | "chinese.essay"
  | "math.grapher"
  | "math.drill"
  | "english.vocab"
  | "english.verbs";

export interface WidgetDef {
  type: WidgetType;
  title: string;
  description: string;
  /** 所属领域，便于按学习目标筛选 */
  domain: string;
  component: ComponentType;
}

function WidgetSkeleton() {
  return (
    <div className="h-48 animate-pulse rounded-3xl border border-border bg-card/60" />
  );
}

export const WIDGETS: Record<WidgetType, WidgetDef> = {
  "poker.table": {
    type: "poker.table",
    title: "牌桌",
    description: "展示手牌与公共牌，一键随机发牌",
    domain: "poker",
    component: dynamic(
      () =>
        import("@/components/widgets/poker/PokerTable").then(
          (m) => m.PokerTable,
        ),
      { ssr: false, loading: WidgetSkeleton },
    ),
  },
  "poker.equity": {
    type: "poker.equity",
    title: "胜率计算器",
    description: "蒙特卡洛估算对随机对手的胜率",
    domain: "poker",
    component: dynamic(
      () =>
        import("@/components/widgets/poker/EquityCalculator").then(
          (m) => m.EquityCalculator,
        ),
      { ssr: false, loading: WidgetSkeleton },
    ),
  },
  "poker.range": {
    type: "poker.range",
    title: "起手范围矩阵",
    description: "13×13 标记开牌范围，含预设",
    domain: "poker",
    component: dynamic(
      () =>
        import("@/components/widgets/poker/RangeMatrix").then(
          (m) => m.RangeMatrix,
        ),
      { ssr: false, loading: WidgetSkeleton },
    ),
  },
  "japanese.kana": {
    type: "japanese.kana",
    title: "五十音图",
    description: "点选发音，切换平/片假名",
    domain: "japanese",
    component: dynamic(
      () =>
        import("@/components/widgets/japanese/KanaChart").then(
          (m) => m.KanaChart,
        ),
      { ssr: false, loading: WidgetSkeleton },
    ),
  },
  "japanese.flashcards": {
    type: "japanese.flashcards",
    title: "抽认卡 SRS",
    description: "间隔重复背单词，进度本地保存",
    domain: "japanese",
    component: dynamic(
      () =>
        import("@/components/widgets/japanese/Flashcards").then(
          (m) => m.Flashcards,
        ),
      { ssr: false, loading: WidgetSkeleton },
    ),
  },
  "quant.backtest": {
    type: "quant.backtest",
    title: "回测沙盘",
    description: "均线交叉策略 vs 买入持有",
    domain: "quant",
    component: dynamic(
      () =>
        import("@/components/widgets/quant/BacktestSandbox").then(
          (m) => m.BacktestSandbox,
        ),
      { ssr: false, loading: WidgetSkeleton },
    ),
  },
  "quant.kelly": {
    type: "quant.kelly",
    title: "凯利仓位计算器",
    description: "由胜率与赔率求最优下注比例",
    domain: "quant",
    component: dynamic(
      () =>
        import("@/components/widgets/quant/KellyCalculator").then(
          (m) => m.KellyCalculator,
        ),
      { ssr: false, loading: WidgetSkeleton },
    ),
  },
  "commerce.funnel": {
    type: "commerce.funnel",
    title: "转化漏斗",
    description: "各环节转化率与 GMV 复盘",
    domain: "commerce",
    component: dynamic(
      () =>
        import("@/components/widgets/commerce/ConversionFunnel").then(
          (m) => m.ConversionFunnel,
        ),
      { ssr: false, loading: WidgetSkeleton },
    ),
  },
  "commerce.script": {
    type: "commerce.script",
    title: "直播话术脚本",
    description: "结构化脚本模板 + 一键复制",
    domain: "commerce",
    component: dynamic(
      () =>
        import("@/components/widgets/commerce/ScriptBuilder").then(
          (m) => m.ScriptBuilder,
        ),
      { ssr: false, loading: WidgetSkeleton },
    ),
  },
  "chinese.dictation": {
    type: "chinese.dictation",
    title: "古诗文名句默写",
    description: "看上句默下句，自评巩固",
    domain: "chinese",
    component: dynamic(
      () =>
        import("@/components/widgets/chinese/PoemDictation").then(
          (m) => m.PoemDictation,
        ),
      { ssr: false, loading: WidgetSkeleton },
    ),
  },
  "chinese.essay": {
    type: "chinese.essay",
    title: "作文提纲",
    description: "议论文结构化搭框架",
    domain: "chinese",
    component: dynamic(
      () =>
        import("@/components/widgets/chinese/EssayOutline").then(
          (m) => m.EssayOutline,
        ),
      { ssr: false, loading: WidgetSkeleton },
    ),
  },
  "math.grapher": {
    type: "math.grapher",
    title: "函数图像探索",
    description: "调系数实时看图像变化",
    domain: "math",
    component: dynamic(
      () =>
        import("@/components/widgets/math/FunctionGrapher").then(
          (m) => m.FunctionGrapher,
        ),
      { ssr: false, loading: WidgetSkeleton },
    ),
  },
  "math.drill": {
    type: "math.drill",
    title: "口算特训",
    description: "随机出题、即时判分、连击",
    domain: "math",
    component: dynamic(
      () =>
        import("@/components/widgets/math/ArithmeticDrill").then(
          (m) => m.ArithmeticDrill,
        ),
      { ssr: false, loading: WidgetSkeleton },
    ),
  },
  "english.vocab": {
    type: "english.vocab",
    title: "英语词汇卡片",
    description: "看词回忆释义，带发音",
    domain: "english",
    component: dynamic(
      () =>
        import("@/components/widgets/english/VocabCards").then(
          (m) => m.VocabCards,
        ),
      { ssr: false, loading: WidgetSkeleton },
    ),
  },
  "english.verbs": {
    type: "english.verbs",
    title: "不规则动词特训",
    description: "测验模式隐藏答案自评",
    domain: "english",
    component: dynamic(
      () =>
        import("@/components/widgets/english/IrregularVerbs").then(
          (m) => m.IrregularVerbs,
        ),
      { ssr: false, loading: WidgetSkeleton },
    ),
  },
};

export const WIDGET_TYPES = Object.keys(WIDGETS) as WidgetType[];

export interface DomainDef {
  key: string;
  label: string;
  tagline: string;
  widgets: WidgetType[];
}

/** 领域 → 该学习目标下组装的 widget 清单（未来可由学习规划节点动态给出）。 */
export const DOMAINS: DomainDef[] = [
  {
    key: "chinese",
    label: "语文",
    tagline: "积累 · 表达",
    widgets: ["chinese.dictation", "chinese.essay"],
  },
  {
    key: "math",
    label: "数学",
    tagline: "直觉 · 运算",
    widgets: ["math.grapher", "math.drill"],
  },
  {
    key: "english",
    label: "英语",
    tagline: "词汇 · 语法",
    widgets: ["english.vocab", "english.verbs"],
  },
  {
    key: "poker",
    label: "德州扑克",
    tagline: "概率直觉 + 情境决策",
    widgets: ["poker.table", "poker.equity", "poker.range"],
  },
  {
    key: "japanese",
    label: "日语",
    tagline: "记忆 · 发音 · 语感",
    widgets: ["japanese.kana", "japanese.flashcards"],
  },
  {
    key: "quant",
    label: "量化",
    tagline: "边写边跑边可视化",
    widgets: ["quant.backtest", "quant.kelly"],
  },
  {
    key: "commerce",
    label: "直播带货",
    tagline: "实操 + 数据复盘",
    widgets: ["commerce.funnel", "commerce.script"],
  },
];
