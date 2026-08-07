"use client";

import { RotateCcw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Word {
  id: string;
  jp: string;
  kana: string;
  romaji: string;
  meaning: string;
}

const DECK: Word[] = [
  { id: "1", jp: "こんにちは", kana: "こんにちは", romaji: "konnichiwa", meaning: "你好（白天）" },
  { id: "2", jp: "ありがとう", kana: "ありがとう", romaji: "arigatō", meaning: "谢谢" },
  { id: "3", jp: "すみません", kana: "すみません", romaji: "sumimasen", meaning: "对不起 / 打扰了" },
  { id: "4", jp: "おはよう", kana: "おはよう", romaji: "ohayō", meaning: "早上好" },
  { id: "5", jp: "さようなら", kana: "さようなら", romaji: "sayōnara", meaning: "再见" },
  { id: "6", jp: "水", kana: "みず", romaji: "mizu", meaning: "水" },
  { id: "7", jp: "食べる", kana: "たべる", romaji: "taberu", meaning: "吃" },
  { id: "8", jp: "飲む", kana: "のむ", romaji: "nomu", meaning: "喝" },
  { id: "9", jp: "大きい", kana: "おおきい", romaji: "ōkii", meaning: "大的" },
  { id: "10", jp: "学生", kana: "がくせい", romaji: "gakusei", meaning: "学生" },
  { id: "11", jp: "先生", kana: "せんせい", romaji: "sensei", meaning: "老师" },
  { id: "12", jp: "日本語", kana: "にほんご", romaji: "nihongo", meaning: "日语" },
];

const DAY = 86_400_000;
const STORAGE_KEY = "jp-srs-v1";

interface Sched {
  interval: number; // 天
  ease: number;
  due: number; // 时间戳
}

type Rating = "again" | "hard" | "good" | "easy";

function initSchedule(): Record<string, Sched> {
  const now = Date.now();
  const s: Record<string, Sched> = {};
  for (const w of DECK) s[w.id] = { interval: 0, ease: 2.3, due: now };
  return s;
}

function nextSched(prev: Sched, rating: Rating): Sched {
  let { interval, ease } = prev;
  if (rating === "again") {
    ease = Math.max(1.3, ease - 0.2);
    interval = 0;
  } else if (rating === "hard") {
    ease = Math.max(1.3, ease - 0.15);
    interval = interval === 0 ? 1 : Math.round(interval * 1.2);
  } else if (rating === "good") {
    interval = interval === 0 ? 1 : Math.round(interval * ease);
  } else {
    ease = ease + 0.1;
    interval = interval === 0 ? 3 : Math.round(interval * ease * 1.3);
  }
  return { interval, ease, due: Date.now() + Math.max(0, interval) * DAY };
}

function fmtDue(interval: number): string {
  if (interval <= 0) return "本次内再现";
  if (interval === 1) return "1 天后";
  return `${interval} 天后`;
}

/** 抽认卡 SRS widget：间隔重复复习日语词汇，进度存本地。 */
export function Flashcards() {
  const [schedule, setSchedule] = useState<Record<string, Sched>>(initSchedule);
  const [queue, setQueue] = useState<string[]>([]);
  const [pos, setPos] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // 载入本地进度
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, Sched>;
        setSchedule((prev) => ({ ...prev, ...parsed }));
      }
    } catch {
      /* ignore */
    }
    setLoaded(true);
  }, []);

  // 构建今日到期队列（首次载入后）
  useEffect(() => {
    if (!loaded) return;
    const now = Date.now();
    const due = DECK.filter((w) => (schedule[w.id]?.due ?? now) <= now).map(
      (w) => w.id,
    );
    setQueue(due);
    setPos(0);
    setRevealed(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  function persist(next: Record<string, Sched>) {
    setSchedule(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }

  const currentId = queue[pos];
  const card = useMemo(
    () => DECK.find((w) => w.id === currentId) ?? null,
    [currentId],
  );

  function rate(rating: Rating) {
    if (!card) return;
    const updated = nextSched(schedule[card.id], rating);
    persist({ ...schedule, [card.id]: updated });
    // "又忘了" 本次内再排一次
    if (rating === "again") setQueue((q) => [...q, card.id]);
    setPos((p) => p + 1);
    setRevealed(false);
  }

  function resetAll() {
    const fresh = initSchedule();
    persist(fresh);
    setQueue(DECK.map((w) => w.id));
    setPos(0);
    setRevealed(false);
  }

  const remaining = queue.length - pos;

  return (
    <div className="rounded-3xl border border-border bg-card p-5 shadow-card">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold tracking-tight">抽认卡 · 间隔重复</h3>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>剩余 {Math.max(0, remaining)}</span>
          <Button size="sm" variant="ghost" onClick={resetAll}>
            <RotateCcw className="mr-1 h-3.5 w-3.5" />
            重置
          </Button>
        </div>
      </div>

      {!card ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl bg-muted/40 py-12 text-center">
          <p className="text-sm font-medium">今日复习完成 🎉</p>
          <p className="text-xs text-muted-foreground">
            卡片已按记忆曲线排期，明天再来巩固。
          </p>
          <Button size="sm" variant="secondary" onClick={resetAll}>
            重新开始一轮
          </Button>
        </div>
      ) : (
        <>
          <div className="flex min-h-[160px] flex-col items-center justify-center rounded-2xl border border-border bg-background/60 p-6 text-center">
            <div className="text-4xl font-semibold tracking-tight">{card.jp}</div>
            {revealed ? (
              <div className="mt-3 space-y-1">
                <div className="text-base text-muted-foreground">
                  {card.kana} · {card.romaji}
                </div>
                <div className="text-lg font-medium">{card.meaning}</div>
              </div>
            ) : (
              <div className="mt-4 text-xs text-muted-foreground">
                回想它的读音和意思
              </div>
            )}
          </div>

          {!revealed ? (
            <Button
              className="mt-4 w-full"
              onClick={() => setRevealed(true)}
            >
              显示答案
            </Button>
          ) : (
            <div className="mt-4 grid grid-cols-4 gap-2">
              {(
                [
                  ["again", "忘记"],
                  ["hard", "困难"],
                  ["good", "记得"],
                  ["easy", "简单"],
                ] as [Rating, string][]
              ).map(([r, label]) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => rate(r)}
                  className={cn(
                    "flex flex-col items-center rounded-xl border px-2 py-2 text-xs transition hover:bg-secondary",
                    r === "again"
                      ? "border-rose-300 text-rose-600"
                      : r === "easy"
                        ? "border-emerald-300 text-emerald-700"
                        : "border-border text-foreground",
                  )}
                >
                  <span className="font-medium">{label}</span>
                  <span className="mt-0.5 text-[10px] text-muted-foreground">
                    {fmtDue(nextSched(schedule[card.id], r).interval)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
