"use client";

/**
 * Phase 6.2: 听课 — 录音 + 实时转写 + 一键蒸馏成复习笔记
 *
 * 流程:
 *  1. 用户点大红按钮开始录音,MediaRecorder 每 12s 一段送后端 Whisper
 *  2. 后端返回该段转写,前端追加为一个"带时间戳的段落"(用户可实时看到 / 编辑)
 *  3. 按停止 → 最后一段收尾上传
 *  4. 用户可修改标题 + 各段内容 → 点"保存并生成复习笔记" → 后端 LLM 蒸馏
 *  5. 成功后跳到 /notes/[noteId]
 *
 * 时间戳设计 (参考主流会议纪要):
 *  - 每段左侧一个小灰色 MM:SS 徽标,标明该段音频在整个录音中的起始时刻
 *  - 段落文本用 textarea 单独可编辑,不会互相影响
 *  - 保存时把各段拼成 "[MM:SS] text..." 一起送后端,原始转写附录里保留时间戳
 *
 * localStorage 兜底:防止刷新丢失,每次改动就写一次
 */

import { FileText, Loader2, RotateCcw, Sparkles, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AppHeader } from "@/components/AppHeader";
import { LectureRecorder, type RecorderStatus } from "@/components/LectureRecorder";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { lectureApi } from "@/lib/api";
import { useAgents } from "@/lib/hooks/useAgents";
import { cn } from "@/lib/utils";

const LS_KEY = "lecture:draft:v2"; // v2: chunks 结构 (v1 是 transcript 字符串)

interface TranscriptChunk {
  /** 稳定 id,用作 React key */
  id: string;
  /** 该段音频起始时刻 (相对录音起点) 的秒数 */
  startSec: number;
  /** 段落文本 (可能被用户手改过) */
  text: string;
  /** 是否为手动输入 (非录音自动来的) — 目前只用于 UI 提示 */
  manual?: boolean;
}

interface Draft {
  title: string;
  chunks: TranscriptChunk[];
  savedAt: number;
  /** Phase 6.2+: 上次选择的老师 key (可选) */
  agentKey?: string | null;
  /** Phase 6.2+: 上次的关注角度 (可选) */
  focusHint?: string;
}

function formatTimestamp(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(r)}` : `${pad(m)}:${pad(r)}`;
}

function makeChunkId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export default function LecturePage() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [chunks, setChunks] = useState<TranscriptChunk[]>([]);
  const [agentKey, setAgentKey] = useState<string>(""); // "" 表示不指定老师(通用蒸馏)
  const [focusHint, setFocusHint] = useState("");
  const [recorderStatus, setRecorderStatus] = useState<RecorderStatus>("idle");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [restoredAt, setRestoredAt] = useState<number | null>(null);

  const { data: agents = [], isLoading: agentsLoading } = useAgents();

  // recorder 里的 chunkIndex → 我们这里的 chunk id 映射,避免同一个 index 被追加多次
  const chunkIdByRecorderIdx = useRef<Map<number, string>>(new Map());

  // 从 localStorage 恢复草稿 (兼容旧版 v1: transcript 字符串)
  useEffect(() => {
    try {
      const rawV2 = localStorage.getItem(LS_KEY);
      if (rawV2) {
        const draft = JSON.parse(rawV2) as Draft;
        if (draft?.chunks?.length) {
          setTitle(draft.title || "");
          setChunks(draft.chunks);
          if (draft.agentKey) setAgentKey(draft.agentKey);
          if (draft.focusHint) setFocusHint(draft.focusHint);
          setRestoredAt(draft.savedAt);
          return;
        }
      }
      // v1 兼容:老草稿是一个大字符串,恢复成 startSec=0 的一段
      const rawV1 = localStorage.getItem("lecture:draft:v1");
      if (rawV1) {
        const draftV1 = JSON.parse(rawV1) as {
          title?: string;
          transcript?: string;
          savedAt?: number;
        };
        if (draftV1?.transcript?.trim()) {
          setTitle(draftV1.title || "");
          setChunks([
            {
              id: makeChunkId(),
              startSec: 0,
              text: draftV1.transcript,
              manual: true,
            },
          ]);
          setRestoredAt(draftV1.savedAt ?? Date.now());
        }
        localStorage.removeItem("lecture:draft:v1");
      }
    } catch {
      // ignore
    }
  }, []);

  // chunks / title / agentKey / focusHint 改变时,写入 localStorage
  useEffect(() => {
    if (
      chunks.length === 0 &&
      !title.trim() &&
      !agentKey &&
      !focusHint.trim()
    ) {
      return;
    }
    const payload: Draft = {
      title,
      chunks,
      savedAt: Date.now(),
      agentKey: agentKey || null,
      focusHint,
    };
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(payload));
    } catch {
      // ignore
    }
  }, [title, chunks, agentKey, focusHint]);

  const clearDraft = useCallback(() => {
    setTitle("");
    setChunks([]);
    setAgentKey("");
    setFocusHint("");
    setRestoredAt(null);
    chunkIdByRecorderIdx.current.clear();
    try {
      localStorage.removeItem(LS_KEY);
    } catch {
      // ignore
    }
  }, []);

  /** 录音器新来一段转写 → 追加为一个 TranscriptChunk (按 startSec 升序) */
  const handleTranscriptDelta = useCallback(
    (text: string, recorderIdx: number, startMs: number) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      const startSec = Math.round(startMs / 1000);
      // 同一个 recorderIdx 只应追加一次;若重复来了,更新文本
      const existingId = chunkIdByRecorderIdx.current.get(recorderIdx);
      if (existingId) {
        setChunks((prev) =>
          prev.map((c) => (c.id === existingId ? { ...c, text: trimmed } : c)),
        );
        return;
      }
      const id = makeChunkId();
      chunkIdByRecorderIdx.current.set(recorderIdx, id);
      setChunks((prev) => {
        const next = [
          ...prev,
          { id, startSec, text: trimmed, manual: false } as TranscriptChunk,
        ];
        // 按 startSec 升序 (手动输入的 startSec=0 排最前;录音的按顺序自然升序)
        next.sort((a, b) => a.startSec - b.startSec);
        return next;
      });
    },
    [],
  );

  const updateChunkText = useCallback((id: string, text: string) => {
    setChunks((prev) => prev.map((c) => (c.id === id ? { ...c, text } : c)));
  }, []);

  const removeChunk = useCallback((id: string) => {
    setChunks((prev) => prev.filter((c) => c.id !== id));
    // 别删 map,让同一 recorderIdx 再来时不重建 (删了就当没这段)
  }, []);

  /** 空 chunks 时,提供一个空的 startSec=0 段供用户手动粘贴/输入 */
  const addManualChunk = useCallback(() => {
    setChunks((prev) => [
      ...prev,
      { id: makeChunkId(), startSec: 0, text: "", manual: true },
    ]);
  }, []);

  const isRecording = recorderStatus === "recording" || recorderStatus === "stopping";

  /** 组装成一段完整字符串送后端。每段前加 [MM:SS] 标记,LLM 会保留在附录里 */
  const buildFullTranscript = useCallback((): string => {
    return chunks
      .map((c) => {
        const t = c.text.trim();
        if (!t) return "";
        return `[${formatTimestamp(c.startSec)}] ${t}`;
      })
      .filter(Boolean)
      .join("\n\n");
  }, [chunks]);

  const fullTranscript = useMemo(() => buildFullTranscript(), [buildFullTranscript]);
  const totalChars = useMemo(
    () => chunks.reduce((sum, c) => sum + c.text.length, 0),
    [chunks],
  );
  const canSave = fullTranscript.length > 0 && !isRecording && !saving;

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    setSaveError(null);
    try {
      const note = await lectureApi.saveAsNote({
        transcript: fullTranscript,
        title_hint: title.trim() || null,
        agent_key: agentKey || null,
        focus_hint: focusHint.trim() || null,
        keep_raw_transcript: true,
      });
      try {
        localStorage.removeItem(LS_KEY);
      } catch {
        // ignore
      }
      router.push(`/notes/${note.id}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setSaveError(msg);
      setSaving(false);
    }
  }

  return (
    <div className="min-h-dvh bg-app-gradient">
      <AppHeader />
      <main className="container max-w-3xl space-y-6 py-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">听课</h1>
          <p className="text-sm text-muted-foreground">
            点录音把整堂课录下来,每 12 秒自动转成文字并标上时间戳。结束后一键让
            AI 蒸馏成结构化复习笔记(自动进入笔记库,可搜索、可被对话引用)。
          </p>
        </header>

        {restoredAt && (
          <div className="flex items-center justify-between gap-2 rounded-xl border border-amber-300/50 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            <span>
              已恢复上次未完成的草稿(
              {new Date(restoredAt).toLocaleString("zh-CN", { hour12: false })}
              )。
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="text-amber-800 hover:bg-amber-100"
              onClick={clearDraft}
            >
              <RotateCcw className="mr-1 h-3.5 w-3.5" />
              清空重来
            </Button>
          </div>
        )}

        <LectureRecorder
          onTranscriptDelta={handleTranscriptDelta}
          onStatusChange={setRecorderStatus}
          disabled={saving}
        />

        <section className="space-y-4 rounded-2xl border border-border bg-card p-5 shadow-card">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-base font-semibold">
                实时转写(可以边听边改)
              </h2>
            </div>
            <span className="text-xs text-muted-foreground">
              {chunks.length} 段 · {totalChars} 字
            </span>
          </div>

          <div className="space-y-2">
            <Label htmlFor="lecture-title">
              标题(可选,用于提示 AI 提取主题)
            </Label>
            <Input
              id="lecture-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="例如:高一物理·自由落体运动 / XX 主播美妆专场"
              disabled={saving}
              maxLength={200}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="lecture-agent">
                让哪位老师帮你整理(可选)
              </Label>
              <select
                id="lecture-agent"
                value={agentKey}
                onChange={(e) => setAgentKey(e.target.value)}
                disabled={saving || agentsLoading}
                className={cn(
                  "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm",
                  "ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                  "disabled:cursor-not-allowed disabled:opacity-50",
                )}
              >
                <option value="">通用蒸馏(不指定老师)</option>
                {agents
                  .filter((a) => a.is_active !== false)
                  .map((a) => (
                    <option key={a.agent_key} value={a.agent_key}>
                      {a.emoji ? `${a.emoji} ` : ""}
                      {a.display_name}
                      {a.owner_type === "user" ? " · 我的" : ""}
                    </option>
                  ))}
              </select>
              <p className="text-xs text-muted-foreground">
                选了老师后,笔记会用其人设的知识面 / 术语 / 讲解风格来组织
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="lecture-focus">
                关注角度 / 学习目标(可选)
              </Label>
              <Textarea
                id="lecture-focus"
                value={focusHint}
                onChange={(e) => setFocusHint(e.target.value)}
                placeholder="例如:重点提炼带货直播的成交话术和爆款推荐节奏,忽略产品参数"
                disabled={saving}
                maxLength={800}
                rows={3}
                className="resize-none"
              />
              <p className="text-xs text-muted-foreground">
                自由描述你想学的重点,AI 会按此侧重(而不是套模板)
              </p>
            </div>
          </div>

          <TranscriptChunkList
            chunks={chunks}
            isRecording={isRecording}
            saving={saving}
            onChangeText={updateChunkText}
            onRemove={removeChunk}
            onAddManualChunk={addManualChunk}
          />

          {saveError && (
            <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {saveError}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-end gap-2">
            {chunks.length > 0 && !isRecording && (
              <Button
                type="button"
                variant="ghost"
                onClick={clearDraft}
                disabled={saving}
              >
                <RotateCcw className="mr-1.5 h-4 w-4" />
                清空
              </Button>
            )}
            <Button
              type="button"
              onClick={handleSave}
              disabled={!canSave}
              className="min-w-[220px]"
            >
              {saving ? (
                <>
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                  AI 正在整理笔记…
                </>
              ) : (
                <>
                  <Sparkles className="mr-1.5 h-4 w-4" />
                  保存并生成复习笔记
                </>
              )}
            </Button>
          </div>
          {isRecording && (
            <p className="text-right text-xs text-muted-foreground">
              请先结束录音再保存
            </p>
          )}
        </section>
      </main>
    </div>
  );
}

/** 转写段落列表 — 左侧小灰色时间戳 + 右侧可编辑 textarea */
function TranscriptChunkList({
  chunks,
  isRecording,
  saving,
  onChangeText,
  onRemove,
  onAddManualChunk,
}: {
  chunks: TranscriptChunk[];
  isRecording: boolean;
  saving: boolean;
  onChangeText: (id: string, text: string) => void;
  onRemove: (id: string) => void;
  onAddManualChunk: () => void;
}) {
  if (chunks.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-background/40 p-6 text-center">
        <p className="text-sm text-muted-foreground">
          {isRecording
            ? "转写会在这里以带时间戳的段落形式实时出现…"
            : "点上面红色按钮开始录音,或点下面按钮手动粘贴已有文字"}
        </p>
        {!isRecording && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mt-3"
            onClick={onAddManualChunk}
            disabled={saving}
          >
            手动添加一段
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="divide-y divide-border/60 rounded-xl border border-border bg-background/60">
      {chunks.map((c) => (
        <ChunkRow
          key={c.id}
          chunk={c}
          disabled={saving}
          onChangeText={onChangeText}
          onRemove={onRemove}
        />
      ))}
      {!isRecording && (
        <div className="flex justify-end p-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onAddManualChunk}
            disabled={saving}
            className="text-xs text-muted-foreground"
          >
            + 手动加一段
          </Button>
        </div>
      )}
    </div>
  );
}

/** 单段:左时间戳(小灰) + 右自适应高度 textarea + 悬停显示删除 */
function ChunkRow({
  chunk,
  disabled,
  onChangeText,
  onRemove,
}: {
  chunk: TranscriptChunk;
  disabled: boolean;
  onChangeText: (id: string, text: string) => void;
  onRemove: (id: string) => void;
}) {
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const [hover, setHover] = useState(false);

  // 内容变化时,让 textarea 高度贴合内容
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [chunk.text]);

  return (
    <div
      className="group flex items-start gap-3 px-3 py-3 sm:px-4"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <span
        className="mt-2 w-11 shrink-0 select-none text-right font-mono text-[11px] leading-none tabular-nums text-muted-foreground/70"
        title="该段音频起始时刻(相对录音起点)"
      >
        {formatTimestamp(chunk.startSec)}
      </span>
      <textarea
        ref={taRef}
        value={chunk.text}
        onChange={(e) => onChangeText(chunk.id, e.target.value)}
        disabled={disabled}
        rows={1}
        className={cn(
          "min-w-0 flex-1 resize-none border-none bg-transparent p-0 text-sm leading-6 outline-none",
          "focus:ring-0",
          "placeholder:text-muted-foreground/50",
          chunk.manual && "italic",
        )}
        placeholder={chunk.manual ? "在这里手动输入或粘贴…" : ""}
      />
      <button
        type="button"
        aria-label="删除这一段"
        onClick={() => onRemove(chunk.id)}
        disabled={disabled}
        className={cn(
          "mt-1 shrink-0 rounded p-1 text-muted-foreground/60 transition",
          "hover:bg-destructive/10 hover:text-destructive",
          hover ? "opacity-100" : "opacity-0 sm:opacity-0 group-hover:opacity-100",
        )}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
