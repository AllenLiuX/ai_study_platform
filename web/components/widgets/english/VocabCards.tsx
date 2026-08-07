"use client";

import { RotateCcw, Volume2 } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";

interface Word {
  word: string;
  phonetic: string;
  pos: string;
  meaning: string;
  example: string;
}

const DECK: Word[] = [
  { word: "abandon", phonetic: "/əˈbændən/", pos: "v.", meaning: "抛弃；放弃", example: "They had to abandon the plan." },
  { word: "benefit", phonetic: "/ˈbenɪfɪt/", pos: "n./v.", meaning: "好处；受益", example: "Regular exercise benefits your health." },
  { word: "consider", phonetic: "/kənˈsɪdə/", pos: "v.", meaning: "考虑；认为", example: "Please consider my suggestion." },
  { word: "deliberate", phonetic: "/dɪˈlɪbərət/", pos: "adj.", meaning: "故意的；深思熟虑的", example: "It was a deliberate choice." },
  { word: "efficient", phonetic: "/ɪˈfɪʃnt/", pos: "adj.", meaning: "高效的", example: "She is an efficient worker." },
  { word: "fascinate", phonetic: "/ˈfæsɪneɪt/", pos: "v.", meaning: "使着迷", example: "The story fascinated the children." },
  { word: "genuine", phonetic: "/ˈdʒenjuɪn/", pos: "adj.", meaning: "真正的；真诚的", example: "He showed genuine concern." },
  { word: "hesitate", phonetic: "/ˈhezɪteɪt/", pos: "v.", meaning: "犹豫", example: "Don't hesitate to ask." },
  { word: "inevitable", phonetic: "/ɪnˈevɪtəbl/", pos: "adj.", meaning: "不可避免的", example: "Change is inevitable." },
  { word: "justify", phonetic: "/ˈdʒʌstɪfaɪ/", pos: "v.", meaning: "证明……正当", example: "How do you justify this?" },
  { word: "maintain", phonetic: "/meɪnˈteɪn/", pos: "v.", meaning: "维持；保养", example: "Maintain a healthy diet." },
  { word: "reluctant", phonetic: "/rɪˈlʌktənt/", pos: "adj.", meaning: "不情愿的", example: "He was reluctant to leave." },
];

function speak(text: string) {
  if (typeof window === "undefined" || !window.speechSynthesis) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "en-US";
  u.rate = 0.9;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(u);
}

function shuffledIdx(): number[] {
  const idx = DECK.map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return idx;
}

/** 英语词汇卡片 widget：看词回忆释义，带发音，自评循环。 */
export function VocabCards() {
  const [order, setOrder] = useState<number[]>(() => shuffledIdx());
  const [pos, setPos] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [known, setKnown] = useState(0);
  const [seen, setSeen] = useState(0);

  const card = useMemo(() => DECK[order[pos]], [order, pos]);
  const done = pos >= order.length;

  function grade(ok: boolean) {
    setSeen((s) => s + 1);
    if (ok) setKnown((k) => k + 1);
    setPos((p) => p + 1);
    setRevealed(false);
  }

  function restart() {
    setOrder(shuffledIdx());
    setPos(0);
    setRevealed(false);
    setKnown(0);
    setSeen(0);
  }

  return (
    <div className="rounded-3xl border border-border bg-card p-5 shadow-card">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold tracking-tight">英语词汇卡片</h3>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>
            {Math.min(pos + (done ? 0 : 1), order.length)}/{order.length}
          </span>
          <Button size="sm" variant="ghost" onClick={restart}>
            <RotateCcw className="mr-1 h-3.5 w-3.5" />
            重来
          </Button>
        </div>
      </div>

      {done ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl bg-muted/40 py-10 text-center">
          <p className="text-sm font-medium">
            本轮完成 · 认识 {known}/{seen}
          </p>
          <Button size="sm" variant="secondary" onClick={restart}>
            再来一轮
          </Button>
        </div>
      ) : (
        <>
          <div className="flex min-h-[150px] flex-col items-center justify-center rounded-2xl border border-border bg-background/60 p-6 text-center">
            <div className="flex items-center gap-2">
              <span className="text-3xl font-semibold tracking-tight">
                {card.word}
              </span>
              <button
                type="button"
                onClick={() => speak(card.word)}
                className="rounded-full p-1.5 text-muted-foreground transition hover:bg-secondary hover:text-primary"
                aria-label="发音"
              >
                <Volume2 className="h-4 w-4" />
              </button>
            </div>
            {revealed ? (
              <div className="mt-3 space-y-1">
                <div className="text-sm text-muted-foreground">
                  {card.phonetic}
                </div>
                <div className="text-base font-medium">
                  <span className="text-muted-foreground">{card.pos}</span>{" "}
                  {card.meaning}
                </div>
                <div className="mt-1 text-xs italic text-muted-foreground">
                  “{card.example}”
                </div>
              </div>
            ) : (
              <div className="mt-3 text-xs text-muted-foreground">
                回忆它的读音和释义
              </div>
            )}
          </div>

          {!revealed ? (
            <Button className="mt-4 w-full" onClick={() => setRevealed(true)}>
              显示释义
            </Button>
          ) : (
            <div className="mt-4 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => grade(false)}
                className="rounded-xl border border-rose-300 py-2.5 text-sm font-medium text-rose-600 transition hover:bg-rose-50"
              >
                不认识
              </button>
              <button
                type="button"
                onClick={() => grade(true)}
                className="rounded-xl border border-emerald-300 py-2.5 text-sm font-medium text-emerald-700 transition hover:bg-emerald-50"
              >
                认识
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
