"use client";

import { Eye, EyeOff, Pause, Play, SkipBack, SkipForward, Volume2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import type { AudioTrainerConfig } from "@/lib/practice/spec";
import { cn } from "@/lib/utils";

export function AudioTrainer({ config }: { config: AudioTrainerConfig }) {
  if (config.mode === "metronome") return <Metronome config={config} />;
  return <Shadow config={config} />;
}

function speak(text: string, lang: string, rate: number) {
  if (typeof window === "undefined" || !window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang;
  u.rate = rate;
  window.speechSynthesis.speak(u);
}

function Shadow({ config }: { config: AudioTrainerConfig }) {
  const items = config.items ?? [];
  const lang = config.lang ?? "en-US";
  const [idx, setIdx] = useState(0);
  const [rate, setRate] = useState(0.9);
  const [showTrans, setShowTrans] = useState(true);
  const supported =
    typeof window !== "undefined" && !!window.speechSynthesis;
  const item = items[idx];

  function go(delta: number) {
    setIdx((i) => (i + delta + items.length) % items.length);
  }

  useEffect(() => () => window.speechSynthesis?.cancel(), []);

  return (
    <div className="space-y-4">
      {!supported && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
          当前浏览器不支持语音合成，无法朗读。
        </p>
      )}
      <div className="rounded-2xl border border-border bg-background/60 p-6 text-center">
        <div className="text-xl font-semibold leading-relaxed">{item?.text}</div>
        {showTrans && item?.translation && (
          <div className="mt-2 text-sm text-muted-foreground">
            {item.translation}
          </div>
        )}
      </div>

      <div className="flex items-center justify-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => go(-1)}>
          <SkipBack className="h-4 w-4" />
        </Button>
        <Button onClick={() => item && speak(item.text, lang, rate)} disabled={!supported}>
          <Volume2 className="mr-1.5 h-4 w-4" />
          朗读
        </Button>
        <Button variant="ghost" size="sm" onClick={() => go(1)}>
          <SkipForward className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {idx + 1} / {items.length}
        </span>
        <label className="flex items-center gap-2">
          语速
          <input
            type="range"
            min={0.5}
            max={1.2}
            step={0.1}
            value={rate}
            onChange={(e) => setRate(Number(e.target.value))}
            className="w-24 accent-primary"
          />
          {rate.toFixed(1)}x
        </label>
        <button
          type="button"
          onClick={() => setShowTrans((v) => !v)}
          className="flex items-center gap-1 hover:text-foreground"
        >
          {showTrans ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          译文
        </button>
      </div>
    </div>
  );
}

function Metronome({ config }: { config: AudioTrainerConfig }) {
  const min = config.bpmMin ?? 40;
  const max = config.bpmMax ?? 200;
  const [bpm, setBpm] = useState(config.bpmDefault ?? 80);
  const [playing, setPlaying] = useState(false);
  const [beat, setBeat] = useState(0);
  const ctxRef = useRef<AudioContext | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stop = useMemo(
    () => () => {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
      setPlaying(false);
    },
    [],
  );

  useEffect(() => () => stop(), [stop]);

  function click() {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctx) return;
    if (!ctxRef.current) ctxRef.current = new Ctx();
    const ctx = ctxRef.current;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 1000;
    gain.gain.setValueAtTime(0.001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.4, ctx.currentTime + 0.001);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.05);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.06);
    setBeat((b) => (b + 1) % 4);
  }

  function toggle() {
    if (playing) {
      stop();
      return;
    }
    setPlaying(true);
    setBeat(0);
    click();
    timerRef.current = setInterval(click, (60 / bpm) * 1000);
  }

  useEffect(() => {
    if (!playing) return;
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(click, (60 / bpm) * 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bpm]);

  return (
    <div className="space-y-5 text-center">
      <div className="flex justify-center gap-2">
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className={cn(
              "h-3 w-3 rounded-full transition",
              playing && beat === i ? "bg-primary scale-125" : "bg-secondary",
            )}
          />
        ))}
      </div>
      <div className="text-4xl font-bold tabular-nums">{bpm}</div>
      <div className="text-xs text-muted-foreground">BPM</div>
      <input
        type="range"
        min={min}
        max={max}
        value={bpm}
        onChange={(e) => setBpm(Number(e.target.value))}
        className="w-full accent-primary"
      />
      <Button onClick={toggle}>
        {playing ? (
          <>
            <Pause className="mr-1.5 h-4 w-4" />
            停止
          </>
        ) : (
          <>
            <Play className="mr-1.5 h-4 w-4" />
            开始
          </>
        )}
      </Button>
    </div>
  );
}
