"use client";

import { Check, X } from "lucide-react";
import { useState } from "react";

import { MarkdownMessage } from "@/components/MarkdownMessage";
import { Button } from "@/components/ui/button";
import { WidgetRenderer } from "@/components/widgets/WidgetRenderer";
import {
  type FillBlankBlock,
  type FlashcardBlock,
  type InfoBlock,
  isGradable,
  type MatchBlock,
  type McqBlock,
  type MultiBlock,
  normalizeAnswer,
  type OrderBlock,
  type PracticeBlock,
  type ShortAnswerBlock,
  type WidgetBlock,
} from "@/lib/practice/spec";
import { WIDGET_TYPES, type WidgetType } from "@/lib/widgets/registry";
import { cn } from "@/lib/utils";

const BLOCK_LABEL: Record<PracticeBlock["type"], string> = {
  info: "说明",
  mcq: "单选题",
  multi: "多选题",
  fill_blank: "填空题",
  flashcard: "闪卡",
  match: "配对",
  order: "排序",
  short_answer: "简答",
  widget: "互动组件",
};

function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 单个练习块的外层壳（标号 + 类型标签）。 */
export function PracticeBlockCard({
  block,
  index,
  onResult,
}: {
  block: PracticeBlock;
  index: number;
  onResult: (correct: boolean) => void;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-card">
      <div className="mb-3 flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
          {index + 1}
        </span>
        <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium text-secondary-foreground">
          {BLOCK_LABEL[block.type]}
        </span>
        {!isGradable(block) && block.type !== "info" && block.type !== "widget" && (
          <span className="text-[11px] text-muted-foreground">不计分</span>
        )}
      </div>
      <BlockBody block={block} onResult={onResult} />
    </div>
  );
}

function BlockBody({
  block,
  onResult,
}: {
  block: PracticeBlock;
  onResult: (correct: boolean) => void;
}) {
  switch (block.type) {
    case "info":
      return <InfoView block={block} />;
    case "mcq":
      return <McqView block={block} onResult={onResult} />;
    case "multi":
      return <MultiView block={block} onResult={onResult} />;
    case "fill_blank":
      return <FillBlankView block={block} onResult={onResult} />;
    case "flashcard":
      return <FlashcardView block={block} />;
    case "match":
      return <MatchView block={block} onResult={onResult} />;
    case "order":
      return <OrderView block={block} onResult={onResult} />;
    case "short_answer":
      return <ShortAnswerView block={block} onResult={onResult} />;
    case "widget":
      return <WidgetView block={block} />;
    default:
      return null;
  }
}

function Feedback({ correct }: { correct: boolean }) {
  return (
    <div
      className={cn(
        "mt-3 flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium",
        correct ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700",
      )}
    >
      {correct ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}
      {correct ? "回答正确" : "再想想 / 看下解析"}
    </div>
  );
}

function InfoView({ block }: { block: InfoBlock }) {
  return (
    <div>
      {block.title && (
        <h4 className="mb-1 text-sm font-semibold">{block.title}</h4>
      )}
      <MarkdownMessage content={block.markdown} className="text-sm" />
    </div>
  );
}

function McqView({
  block,
  onResult,
}: {
  block: McqBlock;
  onResult: (correct: boolean) => void;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const [submitted, setSubmitted] = useState(false);

  function submit() {
    if (selected === null || submitted) return;
    setSubmitted(true);
    onResult(selected === block.answer);
  }

  return (
    <div>
      <MarkdownMessage content={block.prompt} className="text-[15px]" />
      <div className="mt-3 space-y-2">
        {block.options.map((opt, i) => {
          const isAnswer = i === block.answer;
          const isPicked = i === selected;
          return (
            <button
              key={i}
              type="button"
              disabled={submitted}
              onClick={() => setSelected(i)}
              className={cn(
                "flex w-full items-center gap-2 rounded-xl border px-3 py-2 text-left text-sm transition",
                submitted
                  ? isAnswer
                    ? "border-emerald-400 bg-emerald-50"
                    : isPicked
                      ? "border-rose-400 bg-rose-50"
                      : "border-border opacity-70"
                  : isPicked
                    ? "border-primary bg-primary/10"
                    : "border-border hover:bg-secondary",
              )}
            >
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px]">
                {String.fromCharCode(65 + i)}
              </span>
              <span className="min-w-0 flex-1">{opt}</span>
            </button>
          );
        })}
      </div>
      {!submitted ? (
        <Button className="mt-3" size="sm" disabled={selected === null} onClick={submit}>
          提交
        </Button>
      ) : (
        <>
          <Feedback correct={selected === block.answer} />
          {block.explanation && (
            <div className="mt-2 rounded-lg bg-muted/50 p-3">
              <MarkdownMessage content={block.explanation} className="text-sm" />
            </div>
          )}
        </>
      )}
    </div>
  );
}

function MultiView({
  block,
  onResult,
}: {
  block: MultiBlock;
  onResult: (correct: boolean) => void;
}) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [submitted, setSubmitted] = useState(false);
  const answerSet = new Set(block.answers);

  function toggle(i: number) {
    if (submitted) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  function submit() {
    if (submitted || selected.size === 0) return;
    setSubmitted(true);
    const correct =
      selected.size === answerSet.size &&
      [...selected].every((i) => answerSet.has(i));
    onResult(correct);
  }

  const isCorrect =
    selected.size === answerSet.size &&
    [...selected].every((i) => answerSet.has(i));

  return (
    <div>
      <MarkdownMessage content={block.prompt} className="text-[15px]" />
      <div className="mt-3 space-y-2">
        {block.options.map((opt, i) => {
          const picked = selected.has(i);
          const isAns = answerSet.has(i);
          return (
            <button
              key={i}
              type="button"
              disabled={submitted}
              onClick={() => toggle(i)}
              className={cn(
                "flex w-full items-center gap-2 rounded-xl border px-3 py-2 text-left text-sm transition",
                submitted
                  ? isAns
                    ? "border-emerald-400 bg-emerald-50"
                    : picked
                      ? "border-rose-400 bg-rose-50"
                      : "border-border opacity-70"
                  : picked
                    ? "border-primary bg-primary/10"
                    : "border-border hover:bg-secondary",
              )}
            >
              <span
                className={cn(
                  "flex h-5 w-5 shrink-0 items-center justify-center rounded border text-[11px]",
                  picked && "bg-primary text-primary-foreground",
                )}
              >
                {picked ? "✓" : ""}
              </span>
              <span className="min-w-0 flex-1">{opt}</span>
            </button>
          );
        })}
      </div>
      {!submitted ? (
        <Button className="mt-3" size="sm" disabled={selected.size === 0} onClick={submit}>
          提交（多选）
        </Button>
      ) : (
        <>
          <Feedback correct={isCorrect} />
          {block.explanation && (
            <div className="mt-2 rounded-lg bg-muted/50 p-3">
              <MarkdownMessage content={block.explanation} className="text-sm" />
            </div>
          )}
        </>
      )}
    </div>
  );
}

function FillBlankView({
  block,
  onResult,
}: {
  block: FillBlankBlock;
  onResult: (correct: boolean) => void;
}) {
  const [values, setValues] = useState<string[]>(() =>
    block.blanks.map(() => ""),
  );
  const [submitted, setSubmitted] = useState(false);

  function checkBlank(i: number): boolean {
    const target = block.blanks[i];
    const val = normalizeAnswer(values[i] ?? "");
    if (!val) return false;
    const candidates = [target.answer, ...(target.accept ?? [])].map(
      normalizeAnswer,
    );
    return candidates.includes(val);
  }

  function submit() {
    if (submitted) return;
    setSubmitted(true);
    onResult(block.blanks.every((_, i) => checkBlank(i)));
  }

  return (
    <div>
      <MarkdownMessage content={block.prompt} className="text-[15px]" />
      <div className="mt-3 space-y-2">
        {block.blanks.map((b, i) => {
          const ok = submitted && checkBlank(i);
          return (
            <div key={i} className="flex items-center gap-2">
              <span className="w-12 shrink-0 text-xs text-muted-foreground">
                第 {i + 1} 空
              </span>
              <input
                value={values[i]}
                disabled={submitted}
                onChange={(e) =>
                  setValues((prev) => {
                    const next = prev.slice();
                    next[i] = e.target.value;
                    return next;
                  })
                }
                className={cn(
                  "h-9 flex-1 rounded-lg border bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring",
                  submitted
                    ? ok
                      ? "border-emerald-400 bg-emerald-50"
                      : "border-rose-400 bg-rose-50"
                    : "border-input",
                )}
              />
              {submitted && !ok && (
                <span className="text-xs text-emerald-700">
                  {b.answer}
                </span>
              )}
            </div>
          );
        })}
      </div>
      {!submitted ? (
        <Button
          className="mt-3"
          size="sm"
          disabled={values.every((v) => !v.trim())}
          onClick={submit}
        >
          提交
        </Button>
      ) : (
        <>
          <Feedback correct={block.blanks.every((_, i) => checkBlank(i))} />
          {block.explanation && (
            <div className="mt-2 rounded-lg bg-muted/50 p-3">
              <MarkdownMessage content={block.explanation} className="text-sm" />
            </div>
          )}
        </>
      )}
    </div>
  );
}

function FlashcardView({ block }: { block: FlashcardBlock }) {
  const [idx, setIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const card = block.cards[idx];

  function go(delta: number) {
    setIdx((i) => (i + delta + block.cards.length) % block.cards.length);
    setFlipped(false);
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setFlipped((f) => !f)}
        className="flex min-h-[130px] w-full flex-col items-center justify-center rounded-2xl border border-border bg-background/60 p-6 text-center transition hover:bg-secondary/40"
      >
        <MarkdownMessage
          content={flipped ? card.back : card.front}
          className="text-base"
        />
        <span className="mt-3 text-[11px] text-muted-foreground">
          {flipped ? "点击看正面" : "点击翻面"}
        </span>
      </button>
      <div className="mt-3 flex items-center justify-between text-sm">
        <Button size="sm" variant="ghost" onClick={() => go(-1)}>
          上一张
        </Button>
        <span className="text-xs text-muted-foreground">
          {idx + 1} / {block.cards.length}
        </span>
        <Button size="sm" variant="ghost" onClick={() => go(1)}>
          下一张
        </Button>
      </div>
    </div>
  );
}

function MatchView({
  block,
  onResult,
}: {
  block: MatchBlock;
  onResult: (correct: boolean) => void;
}) {
  const rights = useState(() => shuffle(block.pairs.map((p) => p.right)))[0];
  const [choice, setChoice] = useState<Record<number, string>>({});
  const [submitted, setSubmitted] = useState(false);

  function submit() {
    if (submitted) return;
    setSubmitted(true);
    onResult(block.pairs.every((p, i) => choice[i] === p.right));
  }

  const allChosen = block.pairs.every((_, i) => choice[i]);

  return (
    <div>
      <p className="mb-3 text-sm text-muted-foreground">给左侧每一项选出正确的匹配。</p>
      <div className="space-y-2">
        {block.pairs.map((p, i) => {
          const ok = submitted && choice[i] === p.right;
          return (
            <div key={i} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm">
                {p.left}
              </span>
              <span className="text-muted-foreground">→</span>
              <select
                value={choice[i] ?? ""}
                disabled={submitted}
                onChange={(e) =>
                  setChoice((prev) => ({ ...prev, [i]: e.target.value }))
                }
                className={cn(
                  "h-9 min-w-0 flex-1 rounded-lg border bg-background px-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring",
                  submitted
                    ? ok
                      ? "border-emerald-400 bg-emerald-50"
                      : "border-rose-400 bg-rose-50"
                    : "border-input",
                )}
              >
                <option value="">选择…</option>
                {rights.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
              {submitted && !ok && (
                <span className="max-w-[40%] truncate text-xs text-emerald-700">
                  {p.right}
                </span>
              )}
            </div>
          );
        })}
      </div>
      {!submitted ? (
        <Button className="mt-3" size="sm" disabled={!allChosen} onClick={submit}>
          提交
        </Button>
      ) : (
        <Feedback correct={block.pairs.every((p, i) => choice[i] === p.right)} />
      )}
    </div>
  );
}

function OrderView({
  block,
  onResult,
}: {
  block: OrderBlock;
  onResult: (correct: boolean) => void;
}) {
  // arrangement 存原始下标；正确顺序为 [0,1,2,...]
  const [arr, setArr] = useState<number[]>(() => {
    const idxs = block.items.map((_, i) => i);
    let shuffled = shuffle(idxs);
    // 避免开局即正确
    if (shuffled.every((v, i) => v === i) && idxs.length > 1) {
      shuffled = [...idxs.slice(1), idxs[0]];
    }
    return shuffled;
  });
  const [submitted, setSubmitted] = useState(false);

  function move(pos: number, delta: number) {
    if (submitted) return;
    const target = pos + delta;
    if (target < 0 || target >= arr.length) return;
    setArr((prev) => {
      const next = prev.slice();
      [next[pos], next[target]] = [next[target], next[pos]];
      return next;
    });
  }

  function submit() {
    if (submitted) return;
    setSubmitted(true);
    onResult(arr.every((v, i) => v === i));
  }

  const isCorrect = arr.every((v, i) => v === i);

  return (
    <div>
      {block.prompt && (
        <MarkdownMessage content={block.prompt} className="text-[15px]" />
      )}
      <div className="mt-3 space-y-2">
        {arr.map((origIdx, pos) => {
          const ok = submitted && origIdx === pos;
          return (
            <div
              key={origIdx}
              className={cn(
                "flex items-center gap-2 rounded-xl border px-3 py-2 text-sm",
                submitted
                  ? ok
                    ? "border-emerald-400 bg-emerald-50"
                    : "border-rose-400 bg-rose-50"
                  : "border-border bg-background",
              )}
            >
              <span className="w-5 shrink-0 text-xs text-muted-foreground">
                {pos + 1}
              </span>
              <span className="min-w-0 flex-1">{block.items[origIdx]}</span>
              {!submitted && (
                <span className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    onClick={() => move(pos, -1)}
                    className="rounded border border-border px-1.5 text-xs hover:bg-secondary"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => move(pos, 1)}
                    className="rounded border border-border px-1.5 text-xs hover:bg-secondary"
                  >
                    ↓
                  </button>
                </span>
              )}
            </div>
          );
        })}
      </div>
      {!submitted ? (
        <Button className="mt-3" size="sm" onClick={submit}>
          提交
        </Button>
      ) : (
        <>
          <Feedback correct={isCorrect} />
          {!isCorrect && (
            <div className="mt-2 rounded-lg bg-muted/50 p-3 text-sm">
              <div className="mb-1 text-xs font-medium text-muted-foreground">
                正确顺序：
              </div>
              <ol className="list-decimal space-y-0.5 pl-5">
                {block.items.map((it, i) => (
                  <li key={i}>{it}</li>
                ))}
              </ol>
            </div>
          )}
          {block.explanation && (
            <div className="mt-2 rounded-lg bg-muted/50 p-3">
              <MarkdownMessage content={block.explanation} className="text-sm" />
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ShortAnswerView({
  block,
  onResult,
}: {
  block: ShortAnswerBlock;
  onResult: (correct: boolean) => void;
}) {
  const [text, setText] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [graded, setGraded] = useState(false);

  const covered = (block.keywords ?? []).filter((k) =>
    normalizeAnswer(text).includes(normalizeAnswer(k)),
  );

  function grade(ok: boolean) {
    if (graded) return;
    setGraded(true);
    onResult(ok);
  }

  return (
    <div>
      <MarkdownMessage content={block.prompt} className="text-[15px]" />
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        placeholder="写下你的答案…"
        disabled={graded}
        className="mt-3 w-full resize-y rounded-xl border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-ring"
      />
      {!revealed ? (
        <Button
          className="mt-3"
          size="sm"
          variant="secondary"
          onClick={() => setRevealed(true)}
        >
          对照参考答案
        </Button>
      ) : (
        <div className="mt-3 space-y-3">
          {(block.keywords?.length ?? 0) > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {block.keywords!.map((k) => {
                const hit = covered.includes(k);
                return (
                  <span
                    key={k}
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[11px]",
                      hit
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-muted text-muted-foreground",
                    )}
                  >
                    {hit ? "✓ " : ""}
                    {k}
                  </span>
                );
              })}
            </div>
          )}
          <div className="rounded-lg bg-muted/50 p-3">
            <div className="mb-1 text-xs font-medium text-muted-foreground">
              参考答案
            </div>
            <MarkdownMessage content={block.reference} className="text-sm" />
          </div>
          {!graded ? (
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => grade(true)}>
                我答对了
              </Button>
              <Button size="sm" variant="ghost" onClick={() => grade(false)}>
                还不熟
              </Button>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">已记录自评结果。</p>
          )}
        </div>
      )}
    </div>
  );
}

function WidgetView({ block }: { block: WidgetBlock }) {
  const valid = (WIDGET_TYPES as string[]).includes(block.widget);
  return (
    <div>
      {block.note && (
        <p className="mb-3 text-sm text-muted-foreground">{block.note}</p>
      )}
      {valid ? (
        <WidgetRenderer type={block.widget as WidgetType} />
      ) : (
        <div className="rounded-xl border border-dashed border-border bg-muted/40 p-4 text-sm text-muted-foreground">
          未知组件：{block.widget}
        </div>
      )}
    </div>
  );
}
