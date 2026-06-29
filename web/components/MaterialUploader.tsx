"use client";

import { FileText, Loader2, Sparkles, Upload } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { materialsApi } from "@/lib/api";
import type { Material, MaterialType, Subject } from "@/lib/types";
import { cn } from "@/lib/utils";

const TYPE_OPTIONS: { value: MaterialType; label: string }[] = [
  { value: "note", label: "笔记" },
  { value: "textbook", label: "课本" },
  { value: "handout", label: "讲义" },
  { value: "homework", label: "作业" },
  { value: "exam", label: "试卷" },
  { value: "wrong_question", label: "错题本" },
  { value: "other", label: "其他" },
];

// Phase 4.1: 图片资料 (PNG/JPG/WEBP/GIF) 也走资料库,后端用 OpenAI vision 抽 markdown
const ACCEPT = [
  ".pdf,.txt,.md,.markdown",
  "application/pdf,text/plain,text/markdown",
  ".png,.jpg,.jpeg,.webp,.gif",
  "image/png,image/jpeg,image/webp,image/gif",
].join(",");
const MAX_MB = 50;

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

interface MaterialUploaderProps {
  subjects: Subject[];
  onUploaded: (m: Material) => void;
  /** 当前 embedding 模型,展示到帮助文案里 */
  embeddingModel?: string;
}

export function MaterialUploader({
  subjects,
  onUploaded,
  embeddingModel,
}: MaterialUploaderProps) {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [subjectId, setSubjectId] = useState<string | undefined>(undefined);
  const [type, setType] = useState<MaterialType>("note");
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  function pickFile(f: File) {
    // 即使文件不合格也设到 state,让按钮可见可点,
    // 避免用户「选了文件、按钮还是灰」找不到原因。具体校验在 submit 里再做。
    setFile(f);
    if (!title) {
      setTitle(f.name.replace(/\.[^.]+$/, ""));
    }
    if (f.size > MAX_MB * 1024 * 1024) {
      setError(`文件 ${formatSize(f.size)},超过单文件上限 ${MAX_MB}MB,请压缩或拆分后再上传`);
    } else {
      setError(null);
    }
  }

  async function submit() {
    if (!file) {
      setError("请先选一份资料");
      return;
    }
    if (file.size > MAX_MB * 1024 * 1024) {
      setError(`文件 ${formatSize(file.size)},超过单文件上限 ${MAX_MB}MB,请压缩或拆分后再上传`);
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const m = await materialsApi.upload(file, {
        title: title || file.name,
        subject_id: subjectId || null,
        material_type: type,
      });
      onUploaded(m);
      setFile(null);
      setTitle("");
      setSubjectId(undefined);
      setType("note");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-4 rounded-2xl border border-border bg-card p-5 shadow-card">
      <div>
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-base font-semibold">上传一份资料</h3>
          {embeddingModel && (
            <span className="inline-flex items-center gap-1 rounded-full border border-primary/15 bg-primary/5 px-2 py-0.5 text-[11px] font-medium text-primary">
              <Sparkles className="h-3 w-3" />
              {embeddingModel}
            </span>
          )}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          支持 PDF / TXT / Markdown / 图片 (PNG/JPG/WEBP),最大 {MAX_MB}MB。
          扫描版 PDF 和图片会自动用视觉模型抽成 markdown(含公式),再切片向量化,
          之后在对话里可以勾选这份资料让 AI 基于它回答。
        </p>
      </div>

      <label
        htmlFor="file-input"
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const f = e.dataTransfer.files?.[0];
          if (f) pickFile(f);
        }}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border bg-background/60 px-6 py-8 text-center transition",
          "hover:border-primary/50 hover:bg-primary/5",
          dragOver && "border-primary bg-primary/5",
          file && "border-primary/40 bg-primary/5",
        )}
      >
        {file ? (
          <>
            <FileText className="h-7 w-7 text-primary" />
            <div className="text-sm font-medium break-all">{file.name}</div>
            <div className="text-xs text-muted-foreground">
              {formatSize(file.size)} · 点击或拖拽更换
            </div>
          </>
        ) : (
          <>
            <Upload className="h-7 w-7 text-muted-foreground" />
            <div className="text-sm font-medium">把文件拖到这里,或点击选择</div>
            <div className="text-xs text-muted-foreground">
              PDF / TXT / Markdown / 图片 · 扫描件和图片走视觉提取
            </div>
          </>
        )}
        <input
          id="file-input"
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) pickFile(f);
          }}
        />
      </label>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="sm:col-span-1">
          <Label htmlFor="material-title">标题</Label>
          <Input
            id="material-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="例如:第三章 函数复习"
          />
        </div>
        <div>
          <Label htmlFor="material-subject">学科</Label>
          <Select
            id="material-subject"
            value={subjectId ?? ""}
            onChange={(e) => setSubjectId(e.target.value || undefined)}
          >
            <option value="">不限学科</option>
            {subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="material-type">类型</Label>
          <Select
            id="material-type"
            value={type}
            onChange={(e) => setType(e.target.value as MaterialType)}
          >
            {TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        {file && (
          <Button
            variant="ghost"
            onClick={() => {
              setFile(null);
              setTitle("");
              setError(null);
            }}
          >
            取消
          </Button>
        )}
        <Button onClick={submit} disabled={!file || uploading}>
          {uploading ? (
            <>
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              上传中…
            </>
          ) : (
            <>
              <Sparkles className="mr-1.5 h-4 w-4" />
              上传并交给 AI 切片
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
