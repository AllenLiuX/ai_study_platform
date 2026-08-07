// Phase 10 · 练习工坊 —— 练习规格 (spec) 的前端类型与判别联合。
// 需与后端 api/app/services/practice_studio_service.py 的 schema 保持一致。

export interface InfoBlock {
  type: "info";
  title?: string;
  markdown: string;
}

export interface McqBlock {
  type: "mcq";
  prompt: string;
  options: string[];
  answer: number;
  explanation?: string;
}

export interface MultiBlock {
  type: "multi";
  prompt: string;
  options: string[];
  answers: number[];
  explanation?: string;
}

export interface FillBlankBlock {
  type: "fill_blank";
  prompt: string;
  blanks: { answer: string; accept?: string[] }[];
  explanation?: string;
}

export interface FlashcardBlock {
  type: "flashcard";
  cards: { front: string; back: string }[];
}

export interface MatchBlock {
  type: "match";
  pairs: { left: string; right: string }[];
}

export interface OrderBlock {
  type: "order";
  prompt?: string;
  items: string[]; // 正确顺序
  explanation?: string;
}

export interface ShortAnswerBlock {
  type: "short_answer";
  prompt: string;
  reference: string;
  keywords?: string[];
}

export interface WidgetBlock {
  type: "widget";
  widget: string;
  note?: string;
}

export type PracticeBlock =
  | InfoBlock
  | McqBlock
  | MultiBlock
  | FillBlankBlock
  | FlashcardBlock
  | MatchBlock
  | OrderBlock
  | ShortAnswerBlock
  | WidgetBlock;

export type PracticeMode = "structured" | "sandbox";

export interface PracticeSpec {
  title: string;
  domain?: string;
  description?: string;
  mode: PracticeMode;
  blocks?: PracticeBlock[];
  sandbox_html?: string;
}

/** 是否为可判分的练习块（用于计分与进度）。 */
export function isGradable(block: PracticeBlock): boolean {
  return (
    block.type === "mcq" ||
    block.type === "multi" ||
    block.type === "fill_blank" ||
    block.type === "order" ||
    block.type === "match" ||
    block.type === "short_answer"
  );
}

/** 规范化答案文本用于填空/简答比对。 */
export function normalizeAnswer(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[。，、．,.!?；;：:]+$/g, "");
}
