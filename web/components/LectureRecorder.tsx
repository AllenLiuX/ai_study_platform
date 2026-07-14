"use client";

/**
 * Phase 6.2: 听课录音组件
 *
 * 核心策略 — MediaRecorder "重启循环":
 *  - 每 CHUNK_MS 一个循环:new MediaRecorder(stream) → start() → 到点 stop()
 *  - stop() 触发 onstop,把这一段整块 blob 上传转写,并立即启新一段
 *  - 每段都是"完整的" webm/mp4 音频文件,单独可解码,Whisper 一段一段吃
 *
 * 为什么不用 timeslice?
 *  - MediaRecorder 用 timeslice 时,第一个 chunk 含容器头,后续只是数据帧
 *    单独上传后续 chunk 服务端解不了。重启循环是最鲁棒的分段方案。
 *
 * iOS Safari 兼容:
 *  - Safari 不支持 audio/webm,支持 audio/mp4 (audio/aac)
 *  - 用 MediaRecorder.isTypeSupported() 依次挑一个能用的
 *
 * 转写状态外露给 parent,parent 负责渲染 transcript / 保存按钮
 */

import { AlertCircle, Loader2, Mic, Square } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { lectureApi } from "@/lib/api";
import { cn } from "@/lib/utils";

/** 每段音频时长 (ms) — 太短转写次数太多且丢上下文,太长实时感差 */
const CHUNK_MS = 12_000;
/** 单段上传失败最多重试次数 */
const MAX_RETRY = 2;

/** 依次挑一个浏览器/OS 支持的 MediaRecorder 编码。返回 [mimeType, filename] */
function pickMimeType(): { mime: string; ext: string } {
  const candidates: { mime: string; ext: string }[] = [
    { mime: "audio/webm;codecs=opus", ext: "webm" },
    { mime: "audio/webm", ext: "webm" },
    { mime: "audio/mp4;codecs=mp4a.40.2", ext: "m4a" }, // Safari
    { mime: "audio/mp4", ext: "m4a" },
    { mime: "audio/mpeg", ext: "mp3" },
    { mime: "audio/wav", ext: "wav" },
  ];
  if (typeof MediaRecorder === "undefined") {
    return { mime: "", ext: "webm" };
  }
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported(c.mime)) return c;
  }
  return { mime: "", ext: "webm" };
}

function formatDuration(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(r)}` : `${pad(m)}:${pad(r)}`;
}

export type RecorderStatus = "idle" | "recording" | "stopping" | "error";

export interface ChunkState {
  /** 单调递增序号,方便调试 */
  index: number;
  /** 转写状态:发出 -> 完成/失败 */
  status: "uploading" | "done" | "error";
  /** 音频段字节数 */
  bytes: number;
  /** 时长 ms */
  durationMs: number;
  /** 完成后的转写文本 (仅 done) */
  text?: string;
  /** 错误详情 (仅 error) */
  error?: string;
}

interface LectureRecorderProps {
  /** 新一段转写完成:parent 应该追加到累计 transcript */
  onTranscriptDelta: (text: string, chunkIndex: number) => void;
  /** 录音状态变更 (用于禁用其他按钮) */
  onStatusChange?: (status: RecorderStatus) => void;
  /** 顶层错误 (麦克风被拒 / 浏览器不支持 …) */
  onError?: (message: string) => void;
  /** 每段状态列表更新 (可用于渲染状态灯) */
  onChunksChange?: (chunks: ChunkState[]) => void;
  className?: string;
  disabled?: boolean;
}

export function LectureRecorder({
  onTranscriptDelta,
  onStatusChange,
  onError,
  onChunksChange,
  className,
  disabled,
}: LectureRecorderProps) {
  const [status, setStatus] = useState<RecorderStatus>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [chunks, setChunks] = useState<ChunkState[]>([]);
  const [level, setLevel] = useState(0); // 0..1 音量条

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const mimeRef = useRef<{ mime: string; ext: string }>({ mime: "", ext: "webm" });
  const timerRef = useRef<number | null>(null);
  const cycleTimerRef = useRef<number | null>(null);
  const cyclingRef = useRef(false);
  const chunkIdxRef = useRef(0);
  const startedAtRef = useRef(0);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const inFlightAbortsRef = useRef<Set<AbortController>>(new Set());

  const updateStatus = useCallback(
    (s: RecorderStatus) => {
      setStatus(s);
      onStatusChange?.(s);
    },
    [onStatusChange],
  );

  const pushChunk = useCallback(
    (c: ChunkState) => {
      setChunks((prev) => {
        const next = [...prev, c];
        onChunksChange?.(next);
        return next;
      });
    },
    [onChunksChange],
  );

  const updateChunk = useCallback(
    (index: number, patch: Partial<ChunkState>) => {
      setChunks((prev) => {
        const next = prev.map((c) => (c.index === index ? { ...c, ...patch } : c));
        onChunksChange?.(next);
        return next;
      });
    },
    [onChunksChange],
  );

  /** 把一段 blob 送后端转写,失败自动重试 MAX_RETRY 次 */
  const uploadChunk = useCallback(
    async (blob: Blob, index: number, durationMs: number) => {
      const ext = mimeRef.current.ext || "webm";
      const filename = `chunk-${index}.${ext}`;
      let lastErr: unknown;
      for (let attempt = 0; attempt <= MAX_RETRY; attempt++) {
        const ctrl = new AbortController();
        inFlightAbortsRef.current.add(ctrl);
        try {
          const { text } = await lectureApi.transcribeChunk(blob, {
            filename,
            signal: ctrl.signal,
          });
          inFlightAbortsRef.current.delete(ctrl);
          updateChunk(index, { status: "done", text, durationMs });
          if (text.trim()) onTranscriptDelta(text, index);
          return;
        } catch (err) {
          inFlightAbortsRef.current.delete(ctrl);
          lastErr = err;
          if ((err as Error).name === "AbortError") return; // 停止时主动取消,不算错
          if (attempt < MAX_RETRY) {
            await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
            continue;
          }
        }
      }
      const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
      updateChunk(index, { status: "error", error: msg, durationMs });
      // 单段失败不打断录音,只留下红色状态灯
      console.warn(`[LectureRecorder] chunk ${index} failed:`, msg);
    },
    [onTranscriptDelta, updateChunk],
  );

  const startCycle = useCallback(() => {
    const stream = streamRef.current;
    if (!stream || !cyclingRef.current) return;

    const mimeType = mimeRef.current.mime;
    let rec: MediaRecorder;
    try {
      rec = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(`创建 MediaRecorder 失败: ${msg}`);
      onError?.(msg);
      updateStatus("error");
      return;
    }
    recorderRef.current = rec;
    const idx = ++chunkIdxRef.current;
    const cycleStart = performance.now();
    const parts: Blob[] = [];

    rec.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) parts.push(e.data);
    };
    rec.onstop = () => {
      const durationMs = performance.now() - cycleStart;
      const blob = new Blob(parts, { type: rec.mimeType || mimeType || "audio/webm" });
      if (blob.size > 0) {
        pushChunk({
          index: idx,
          status: "uploading",
          bytes: blob.size,
          durationMs,
        });
        // fire-and-forget,不阻塞下一段
        void uploadChunk(blob, idx, durationMs);
      }
      // 只要还在录,立刻开新一段(不留缝)
      if (cyclingRef.current) startCycle();
    };
    rec.onerror = (e) => {
      const msg = (e as unknown as { error?: Error })?.error?.message ?? "MediaRecorder error";
      console.warn("[LectureRecorder] recorder error", msg);
    };

    try {
      rec.start();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(`录音启动失败: ${msg}`);
      onError?.(msg);
      updateStatus("error");
      return;
    }

    // 到点 stop,触发 onstop 里的循环
    cycleTimerRef.current = window.setTimeout(() => {
      try {
        if (rec.state !== "inactive") rec.stop();
      } catch (err) {
        console.warn("[LectureRecorder] stop failed", err);
      }
    }, CHUNK_MS);
  }, [onError, pushChunk, updateStatus, uploadChunk]);

  const teardownAudioLevel = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (audioCtxRef.current) {
      void audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
      analyserRef.current = null;
    }
    setLevel(0);
  }, []);

  const setupAudioLevel = useCallback((stream: MediaStream) => {
    try {
      const w = window as unknown as {
        AudioContext?: typeof AudioContext;
        webkitAudioContext?: typeof AudioContext;
      };
      const AC = w.AudioContext || w.webkitAudioContext;
      if (!AC) return;
      const ctx = new AC();
      audioCtxRef.current = ctx;
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      src.connect(analyser);
      analyserRef.current = analyser;
      const buf = new Uint8Array(analyser.fftSize);
      const tick = () => {
        analyser.getByteTimeDomainData(buf);
        let peak = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = Math.abs(buf[i] - 128) / 128;
          if (v > peak) peak = v;
        }
        setLevel(peak);
        rafRef.current = requestAnimationFrame(tick);
      };
      tick();
    } catch (err) {
      console.warn("[LectureRecorder] audio level tap failed", err);
    }
  }, []);

  const start = useCallback(async () => {
    if (status === "recording") return;
    setErrorMsg(null);
    setChunks([]);
    onChunksChange?.([]);
    chunkIdxRef.current = 0;

    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      const msg = "当前浏览器不支持录音 (需要 HTTPS + getUserMedia 支持)";
      setErrorMsg(msg);
      onError?.(msg);
      return;
    }
    if (typeof MediaRecorder === "undefined") {
      const msg = "当前浏览器不支持 MediaRecorder,建议用最新版 Chrome/Safari";
      setErrorMsg(msg);
      onError?.(msg);
      return;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          // 采样率交给浏览器,Whisper 内部会重采样
        },
      });
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.name === "NotAllowedError"
            ? "麦克风权限被拒,请在浏览器地址栏允许麦克风后重试"
            : `无法访问麦克风: ${err.message}`
          : String(err);
      setErrorMsg(msg);
      onError?.(msg);
      return;
    }
    streamRef.current = stream;
    mimeRef.current = pickMimeType();

    setupAudioLevel(stream);
    startedAtRef.current = performance.now();
    setElapsedSec(0);
    timerRef.current = window.setInterval(() => {
      setElapsedSec(Math.floor((performance.now() - startedAtRef.current) / 1000));
    }, 500);

    cyclingRef.current = true;
    updateStatus("recording");
    startCycle();
  }, [onChunksChange, onError, setupAudioLevel, startCycle, status, updateStatus]);

  const stop = useCallback(() => {
    if (status !== "recording") return;
    updateStatus("stopping");
    cyclingRef.current = false;
    if (cycleTimerRef.current) {
      clearTimeout(cycleTimerRef.current);
      cycleTimerRef.current = null;
    }
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") {
      try {
        rec.stop(); // 触发最后一段 onstop 上传
      } catch (err) {
        console.warn("[LectureRecorder] final stop failed", err);
      }
    }
    // 释放麦克风
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    teardownAudioLevel();
    // 等待一小段时间让最后一段上传发出,再切回 idle;转写完成走 uploadChunk 回调
    window.setTimeout(() => updateStatus("idle"), 300);
  }, [status, teardownAudioLevel, updateStatus]);

  // 卸载 / 页面离开兜底
  useEffect(() => {
    const inFlight = inFlightAbortsRef.current;
    return () => {
      cyclingRef.current = false;
      if (cycleTimerRef.current) clearTimeout(cycleTimerRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
      const rec = recorderRef.current;
      if (rec && rec.state !== "inactive") {
        try {
          rec.stop();
        } catch {
          /* noop */
        }
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());
      inFlight.forEach((c) => c.abort());
      teardownAudioLevel();
    };
  }, [teardownAudioLevel]);

  const isRecording = status === "recording";
  const pendingCount = chunks.filter((c) => c.status === "uploading").length;
  const failedCount = chunks.filter((c) => c.status === "error").length;
  const doneCount = chunks.filter((c) => c.status === "done").length;

  return (
    <div
      className={cn(
        "flex flex-col items-center gap-4 rounded-2xl border border-border bg-card p-6 shadow-card",
        className,
      )}
    >
      <RecordButton
        isRecording={isRecording}
        stopping={status === "stopping"}
        disabled={disabled}
        level={level}
        onClick={isRecording ? stop : start}
      />
      <div className="flex items-center gap-3 text-sm">
        <span
          className={cn(
            "font-mono text-2xl tabular-nums tracking-wider",
            isRecording ? "text-destructive" : "text-foreground",
          )}
        >
          {formatDuration(elapsedSec)}
        </span>
        {isRecording && (
          <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
            <span className="h-2 w-2 animate-pulse rounded-full bg-destructive" />
            录音中
          </span>
        )}
        {status === "stopping" && (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            正在收尾最后一段…
          </span>
        )}
      </div>

      {(pendingCount > 0 || failedCount > 0 || doneCount > 0) && (
        <div className="flex flex-wrap items-center justify-center gap-3 text-xs text-muted-foreground">
          <span>共 {chunks.length} 段</span>
          {doneCount > 0 && (
            <span className="text-emerald-600">已转写 {doneCount}</span>
          )}
          {pendingCount > 0 && (
            <span className="inline-flex items-center gap-1 text-primary">
              <Loader2 className="h-3 w-3 animate-spin" />
              转写中 {pendingCount}
            </span>
          )}
          {failedCount > 0 && (
            <span className="inline-flex items-center gap-1 text-destructive">
              <AlertCircle className="h-3 w-3" />
              失败 {failedCount}(录音继续,失败段被跳过)
            </span>
          )}
        </div>
      )}

      {errorMsg && (
        <div className="w-full rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {errorMsg}
        </div>
      )}

      <div className="text-center text-xs text-muted-foreground">
        每 12 秒自动上传一段音频转写。中间可自由休息,别关掉页面。
        {mimeRef.current.mime && (
          <span className="block opacity-60">
            编码: {mimeRef.current.mime}
          </span>
        )}
      </div>
    </div>
  );
}

/** 中央大圆按钮:未录音显示 Mic;录音中显示方块 + 呼吸圈,红光跟着 level */
function RecordButton({
  isRecording,
  stopping,
  disabled,
  level,
  onClick,
}: {
  isRecording: boolean;
  stopping: boolean;
  disabled?: boolean;
  level: number;
  onClick: () => void;
}) {
  const scale = 1 + Math.min(level * 0.35, 0.35);
  return (
    <div className="relative flex h-32 w-32 items-center justify-center">
      {isRecording && (
        <span
          className="pointer-events-none absolute inset-0 rounded-full bg-destructive/25 blur-md transition-transform duration-100"
          style={{ transform: `scale(${scale})` }}
        />
      )}
      <Button
        type="button"
        onClick={onClick}
        disabled={disabled || stopping}
        aria-label={isRecording ? "结束录音" : "开始录音"}
        className={cn(
          "relative h-24 w-24 rounded-full shadow-lg transition",
          isRecording
            ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
            : "bg-primary text-primary-foreground hover:bg-primary/90",
          stopping && "cursor-wait",
        )}
      >
        {stopping ? (
          <Loader2 className="h-8 w-8 animate-spin" />
        ) : isRecording ? (
          <Square className="h-8 w-8 fill-current" />
        ) : (
          <Mic className="h-9 w-9" />
        )}
      </Button>
    </div>
  );
}
