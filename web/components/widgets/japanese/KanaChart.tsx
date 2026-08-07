"use client";

import { Volume2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Kana = { h: string; k: string; r: string } | null;

const ROWS: Kana[][] = [
  [
    { h: "あ", k: "ア", r: "a" },
    { h: "い", k: "イ", r: "i" },
    { h: "う", k: "ウ", r: "u" },
    { h: "え", k: "エ", r: "e" },
    { h: "お", k: "オ", r: "o" },
  ],
  [
    { h: "か", k: "カ", r: "ka" },
    { h: "き", k: "キ", r: "ki" },
    { h: "く", k: "ク", r: "ku" },
    { h: "け", k: "ケ", r: "ke" },
    { h: "こ", k: "コ", r: "ko" },
  ],
  [
    { h: "さ", k: "サ", r: "sa" },
    { h: "し", k: "シ", r: "shi" },
    { h: "す", k: "ス", r: "su" },
    { h: "せ", k: "セ", r: "se" },
    { h: "そ", k: "ソ", r: "so" },
  ],
  [
    { h: "た", k: "タ", r: "ta" },
    { h: "ち", k: "チ", r: "chi" },
    { h: "つ", k: "ツ", r: "tsu" },
    { h: "て", k: "テ", r: "te" },
    { h: "と", k: "ト", r: "to" },
  ],
  [
    { h: "な", k: "ナ", r: "na" },
    { h: "に", k: "ニ", r: "ni" },
    { h: "ぬ", k: "ヌ", r: "nu" },
    { h: "ね", k: "ネ", r: "ne" },
    { h: "の", k: "ノ", r: "no" },
  ],
  [
    { h: "は", k: "ハ", r: "ha" },
    { h: "ひ", k: "ヒ", r: "hi" },
    { h: "ふ", k: "フ", r: "fu" },
    { h: "へ", k: "ヘ", r: "he" },
    { h: "ほ", k: "ホ", r: "ho" },
  ],
  [
    { h: "ま", k: "マ", r: "ma" },
    { h: "み", k: "ミ", r: "mi" },
    { h: "む", k: "ム", r: "mu" },
    { h: "め", k: "メ", r: "me" },
    { h: "も", k: "モ", r: "mo" },
  ],
  [
    { h: "や", k: "ヤ", r: "ya" },
    null,
    { h: "ゆ", k: "ユ", r: "yu" },
    null,
    { h: "よ", k: "ヨ", r: "yo" },
  ],
  [
    { h: "ら", k: "ラ", r: "ra" },
    { h: "り", k: "リ", r: "ri" },
    { h: "る", k: "ル", r: "ru" },
    { h: "れ", k: "レ", r: "re" },
    { h: "ろ", k: "ロ", r: "ro" },
  ],
  [
    { h: "わ", k: "ワ", r: "wa" },
    null,
    null,
    { h: "を", k: "ヲ", r: "wo" },
    { h: "ん", k: "ン", r: "n" },
  ],
];

function speak(text: string) {
  if (typeof window === "undefined" || !window.speechSynthesis) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "ja-JP";
  u.rate = 0.85;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(u);
}

/** 五十音图 widget：点选发音（浏览器 TTS），可切平假名/片假名。 */
export function KanaChart() {
  const [script, setScript] = useState<"h" | "k">("h");
  const [active, setActive] = useState<Kana>(ROWS[0][0]);

  return (
    <div className="rounded-3xl border border-border bg-card p-5 shadow-card">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold tracking-tight">五十音图</h3>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant={script === "h" ? "secondary" : "ghost"}
            onClick={() => setScript("h")}
          >
            平假名
          </Button>
          <Button
            size="sm"
            variant={script === "k" ? "secondary" : "ghost"}
            onClick={() => setScript("k")}
          >
            片假名
          </Button>
        </div>
      </div>

      {active && (
        <div className="mb-4 flex items-center justify-between rounded-2xl bg-primary/5 px-4 py-3">
          <div className="flex items-baseline gap-3">
            <span className="text-4xl font-semibold">
              {script === "h" ? active.h : active.k}
            </span>
            <span className="text-lg text-muted-foreground">{active.r}</span>
          </div>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => speak(script === "h" ? active.h : active.k)}
          >
            <Volume2 className="mr-1 h-3.5 w-3.5" />
            发音
          </Button>
        </div>
      )}

      <div className="space-y-1.5">
        {ROWS.map((row, ri) => (
          <div
            key={ri}
            className="grid gap-1.5"
            style={{ gridTemplateColumns: "repeat(5, minmax(0, 1fr))" }}
          >
            {row.map((cell, ci) =>
              cell ? (
                <button
                  key={ci}
                  type="button"
                  onClick={() => {
                    setActive(cell);
                    speak(script === "h" ? cell.h : cell.k);
                  }}
                  className={cn(
                    "flex flex-col items-center rounded-lg border py-2 transition",
                    active && active.r === cell.r
                      ? "border-primary bg-primary/10"
                      : "border-border bg-card hover:bg-secondary",
                  )}
                >
                  <span className="text-lg font-medium">
                    {script === "h" ? cell.h : cell.k}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {cell.r}
                  </span>
                </button>
              ) : (
                <div key={ci} />
              ),
            )}
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        点击任意假名会朗读发音（依赖浏览器日语语音，部分设备可能无声）。
      </p>
    </div>
  );
}
