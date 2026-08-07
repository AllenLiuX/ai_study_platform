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

// -----------------------------------------------------------------------------
// Phase 10.1 · 交互式训练器 (trainer)
// 工坊的新产物：一个可反复操作的交互式训练器（模板实例 或 现场生成的微应用）。
// -----------------------------------------------------------------------------
export type TrainerTemplateId =
  | "simulator"
  | "timed_drill"
  | "audio_trainer"
  | "flashcards_srs"
  | "drag_order"
  | "decision_tree";

export interface SimulatorConfig {
  params: {
    id: string;
    label: string;
    min: number;
    max: number;
    step: number;
    default: number;
    unit?: string;
  }[];
  outputs: { label: string; expr: string; unit?: string; precision?: number }[];
  chart?: {
    xId: string;
    xLabel?: string;
    xMin: number;
    xMax: number;
    series: { label: string; expr: string }[];
  };
}

export interface TimedDrillConfig {
  durationSec: number;
  mode: "text" | "choice";
  items: { prompt: string; answer: string; options?: string[]; accept?: string[] }[];
}

export interface AudioTrainerConfig {
  mode: "shadow" | "metronome";
  lang?: string;
  items?: { text: string; translation?: string }[];
  bpmDefault?: number;
  bpmMin?: number;
  bpmMax?: number;
}

export interface FlashcardsSrsConfig {
  cards: { front: string; back: string }[];
}

export interface DragOrderConfig {
  mode: "order" | "categorize";
  prompt?: string;
  items?: string[];
  buckets?: { id: string; label: string }[];
  cards?: { text: string; bucket: string }[];
  explanation?: string;
}

export interface DecisionTreeConfig {
  start: string;
  nodes: Record<
    string,
    {
      situation: string;
      options: { label: string; feedback: string; optimal?: boolean; next?: string }[];
    }
  >;
}

export interface TrainerBase {
  title: string;
  domain?: string;
  description?: string;
  goal?: string;
}

export interface TemplateTrainerSpec extends TrainerBase {
  kind: "template";
  template_id: TrainerTemplateId;
  config: unknown;
}

export interface AppTrainerSpec extends TrainerBase {
  kind: "app";
  html: string;
}

export type TrainerSpec = TemplateTrainerSpec | AppTrainerSpec;

/** spec 是否为新的交互式训练器（有 kind 字段）；否则按旧的练习块渲染。 */
export function isTrainerSpec(spec: unknown): spec is TrainerSpec {
  if (!spec || typeof spec !== "object") return false;
  const kind = (spec as { kind?: string }).kind;
  return kind === "template" || kind === "app";
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
