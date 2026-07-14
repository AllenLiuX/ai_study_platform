"use client";

/**
 * Phase 6.2: 听课 — 录音 + 实时转写 + 一键蒸馏成复习笔记
 *
 * 流程:
 *  1. 用户点大红按钮开始录音,MediaRecorder 每 12s 一段送后端 Whisper
 *  2. 后端返回该段转写,前端追加到 transcript textarea (用户可实时看到 / 编辑)
 *  3. 按停止 → 最后一段收尾上传
 *  4. 用户可修改标题 + 转写内容 → 点"保存并生成复习笔记" → 后端 LLM 蒸馏
 *  5. 成功后跳到 /notes/[noteId]
 *
 * localStorage 兜底:防止刷新丢失,60s / 每段写一次
 */

import { FileText, Loader2, RotateCcw, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AppHeader } from "@/components/AppHeader";
import { LectureRecorder, type RecorderStatus } from "@/components/LectureRecorder";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { lectureApi } from "@/lib/api";
import { cn } from "@/lib/utils";

const LS_KEY = "lecture:draft:v1";

interface Draft {
  title: string;
  transcript: string;
  savedAt: number;
}

export default function LecturePage() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [transcript, setTranscript] = useState("");
  const [recorderStatus, setRecorderStatus] = useState<RecorderStatus>("idle");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [restoredAt, setRestoredAt] = useState<number | null>(null);

  // 每段转写通过 index 附加,防止乱序:小 index 拼在前
  const chunkTextsRef = useRef<Map<number, string>>(new Map());

  // 从 localStorage 恢复草稿
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return;
      const draft = JSON.parse(raw) as Draft;
      if (draft?.transcript?.trim()) {
        setTitle(draft.title || "");
        setTranscript(draft.transcript);
        setRestoredAt(draft.savedAt);
      }
    } catch {
      // ignore
    }
  }, []);

  // transcript 或 title 改变时,写入 localStorage
  useEffect(() => {
    if (!transcript.trim() && !title.trim()) return;
    const payload: Draft = { title, transcript, savedAt: Date.now() };
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(payload));
    } catch {
      // ignore
    }
  }, [title, transcript]);

  const clearDraft = useCallback(() => {
    setTitle("");
    setTranscript("");
    setRestoredAt(null);
    chunkTextsRef.current.clear();
    try {
      localStorage.removeItem(LS_KEY);
    } catch {
      // ignore
    }
  }, []);

  const handleTranscriptDelta = useCallback(
    (text: string, chunkIndex: number) => {
      chunkTextsRef.current.set(chunkIndex, text);
      // 按 index 排序拼接,防乱序;每段用换行分开可读性更好
      const merged = Array.from(chunkTextsRef.current.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([, t]) => t.trim())
        .filter(Boolean)
        .join(" ");
      // 保留用户已手动编辑的部分:如果 transcript 里没有当前 merged 前缀
      // (说明用户改过),用换行追加避免覆盖用户修改
      setTranscript((prev) => {
        if (!prev) return merged;
        // 如果 prev 是之前自动累积出来的 (以 merged-片段-earlier 结尾), merge 覆盖
        // 简化处理:比较长度,新的更长时用 merged;否则以用户改过的 prev + 追加为准
        if (prev.length <= merged.length && merged.startsWith(prev.slice(0, Math.floor(prev.length * 0.6)))) {
          return merged;
        }
        return `${prev} ${text.trim()}`.trim();
      });
    },
    [],
  );

  const isRecording = recorderStatus === "recording" || recorderStatus === "stopping";
  const canSave = !!transcript.trim() && !isRecording && !saving;

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    setSaveError(null);
    try {
      const note = await lectureApi.saveAsNote({
        transcript,
        title_hint: title.trim() || null,
        keep_raw_transcript: true,
      });
      // 保存成功清草稿,跳到笔记详情
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

  const transcriptWordCount = useMemo(() => transcript.length, [transcript]);

  return (
    <div className="min-h-dvh bg-app-gradient">
      <AppHeader />
      <main className="container max-w-3xl space-y-6 py-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">听课</h1>
          <p className="text-sm text-muted-foreground">
            点录音把整堂课录下来,每 12 秒自动转成文字。结束后一键让 AI
            蒸馏成一份结构化复习笔记(自动进入你的笔记库,可搜索、可被对话引用)。
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

        <section className="space-y-3 rounded-2xl border border-border bg-card p-5 shadow-card">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-base font-semibold">实时转写(可以边听边改)</h2>
            </div>
            <span className="text-xs text-muted-foreground">
              {transcriptWordCount} 字
            </span>
          </div>

          <div className="space-y-2">
            <Label htmlFor="lecture-title">标题(可选,用于提示 AI 提取主题)</Label>
            <Input
              id="lecture-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="例如:高一物理·自由落体运动"
              disabled={saving}
              maxLength={200}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="lecture-transcript">转写内容</Label>
            <Textarea
              id="lecture-transcript"
              value={transcript}
              onChange={(e) => setTranscript(e.target.value)}
              placeholder={
                isRecording
                  ? "转写会在这里实时出现…"
                  : "点上面的红色按钮开始录音,或直接把已有文字粘贴到这里"
              }
              rows={12}
              className={cn(
                "min-h-[280px] leading-7",
                isRecording && "border-primary/40",
              )}
              disabled={saving}
            />
            <p className="text-xs text-muted-foreground">
              Whisper 可能有识别错字或断句问题,保存前可以直接改。原始转写会作为
              附录保留在生成的笔记末尾,方便对照。
            </p>
          </div>

          {saveError && (
            <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {saveError}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-end gap-2">
            {transcript.trim() && !isRecording && (
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
