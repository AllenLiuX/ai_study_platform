"use client";

import { Globe, ImagePlus, Loader2, Send, Square, X } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { AgentMeta } from "@/lib/agents";
import { chatApi } from "@/lib/api";
import { cn } from "@/lib/utils";

interface ChatInputProps {
  agent: AgentMeta;
  disabled: boolean;
  onSend: (content: string, imagePaths?: string[]) => void;
  onStop?: () => void;
  /** 是否显示新手提问示例 */
  showStarters: boolean;
  /** 可选:渲染在输入框上方的额外控件 (例如资料引用 picker) */
  picker?: React.ReactNode;
  /** Phase 5.5: 联网搜索 toggle (受控) */
  webSearch?: boolean;
  onWebSearchChange?: (next: boolean) => void;
  /** 后端是否支持联网搜索 (没配 TAVILY_API_KEY 时按钮 disabled) */
  webSearchAvailable?: boolean;
}

// Phase 4: 题目图片附件
const MAX_IMAGES = 3;
const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIMES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
]);

interface AttachedImage {
  id: string;
  file: File;
  previewUrl: string;
  storagePath?: string;
  status: "uploading" | "ready" | "error";
  error?: string;
}

export function ChatInput({
  agent,
  disabled,
  onSend,
  onStop,
  showStarters,
  picker,
  webSearch = false,
  onWebSearchChange,
  webSearchAvailable = false,
}: ChatInputProps) {
  const [value, setValue] = useState("");
  const [images, setImages] = useState<AttachedImage[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!textareaRef.current) return;
    textareaRef.current.style.height = "auto";
    textareaRef.current.style.height = `${Math.min(
      textareaRef.current.scrollHeight,
      200,
    )}px`;
  }, [value]);

  // 离开组件时回收 object URL
  useEffect(() => {
    return () => {
      for (const it of images) URL.revokeObjectURL(it.previewUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stillUploading = images.some((it) => it.status === "uploading");
  const readyImages = images.filter(
    (it) => it.status === "ready" && it.storagePath,
  );

  const addOne = useCallback(async (file: File) => {
    const id = crypto.randomUUID();
    const previewUrl = URL.createObjectURL(file);
    setImages((p) => [...p, { id, file, previewUrl, status: "uploading" }]);
    try {
      const a = await chatApi.uploadAttachment(file);
      setImages((p) =>
        p.map((it) =>
          it.id === id
            ? { ...it, status: "ready" as const, storagePath: a.storage_path }
            : it,
        ),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "上传失败";
      setImages((p) =>
        p.map((it) =>
          it.id === id ? { ...it, status: "error" as const, error: msg } : it,
        ),
      );
    }
  }, []);

  const addFiles = useCallback(
    (files: FileList | File[]) => {
      const list = Array.from(files);
      const errs: string[] = [];
      let remaining = MAX_IMAGES - images.length;
      for (const f of list) {
        if (remaining <= 0) {
          errs.push(`最多 ${MAX_IMAGES} 张图`);
          break;
        }
        if (!ALLOWED_MIMES.has(f.type)) {
          errs.push(`不支持 ${f.type || f.name}`);
          continue;
        }
        if (f.size > MAX_BYTES) {
          errs.push(`${f.name} 超过 ${MAX_BYTES / 1024 / 1024}MB`);
          continue;
        }
        void addOne(f);
        remaining -= 1;
      }
      if (errs.length > 0) {
        setUploadError(errs.join("; "));
        window.setTimeout(() => setUploadError(null), 4000);
      } else {
        setUploadError(null);
      }
    },
    [addOne, images.length],
  );

  function removeOne(id: string) {
    setImages((p) => {
      const it = p.find((x) => x.id === id);
      if (it) URL.revokeObjectURL(it.previewUrl);
      return p.filter((x) => x.id !== id);
    });
  }

  function submit() {
    const text = value.trim();
    if (disabled || stillUploading) return;
    if (!text && readyImages.length === 0) return;
    const paths = readyImages.map((it) => it.storagePath!);
    const content = text || "帮我看看这道题";
    onSend(content, paths.length > 0 ? paths : undefined);
    setValue("");
    for (const it of images) URL.revokeObjectURL(it.previewUrl);
    setImages([]);
    setUploadError(null);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  }

  function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    if (!e.clipboardData) return;
    const files: File[] = [];
    for (let i = 0; i < e.clipboardData.items.length; i += 1) {
      const item = e.clipboardData.items[i];
      if (item.kind === "file") {
        const f = item.getAsFile();
        if (f) files.push(f);
      }
    }
    if (files.length > 0) {
      e.preventDefault();
      addFiles(files);
    }
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragActive(false);
    if (e.dataTransfer?.files?.length) {
      addFiles(e.dataTransfer.files);
    }
  }

  return (
    <div className="border-t border-border/60 bg-background/80 backdrop-blur">
      <div className="mx-auto max-w-3xl px-4 py-4 sm:px-6">
        {picker && <div className="mb-2">{picker}</div>}

        {showStarters && (
          <div className="mb-3 flex flex-wrap gap-2">
            {agent.starterPrompts.map((p) => (
              <button
                key={p}
                type="button"
                className="rounded-full border border-border/60 bg-background/60 px-3 py-1.5 text-xs text-muted-foreground transition hover:border-primary/50 hover:text-primary"
                onClick={() => onSend(p)}
                disabled={disabled}
              >
                {p}
              </button>
            ))}
          </div>
        )}

        {/* 缩略图行 — 有图才显示 */}
        {images.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {images.map((it) => (
              <div
                key={it.id}
                className={cn(
                  "group relative h-16 w-16 overflow-hidden rounded-lg border bg-background",
                  it.status === "error"
                    ? "border-destructive/60"
                    : "border-border/60",
                )}
                title={
                  it.status === "error"
                    ? `上传失败:${it.error ?? "未知错误"}`
                    : it.file.name
                }
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={it.previewUrl}
                  alt={it.file.name}
                  className="h-full w-full object-cover"
                />
                {it.status === "uploading" && (
                  <div className="absolute inset-0 flex items-center justify-center bg-background/60">
                    <Loader2 className="h-4 w-4 animate-spin text-foreground" />
                  </div>
                )}
                {it.status === "error" && (
                  <div className="absolute inset-0 flex items-center justify-center bg-destructive/80 text-[10px] font-medium text-destructive-foreground">
                    失败
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => removeOne(it.id)}
                  className="absolute right-0.5 top-0.5 rounded-full bg-background/90 p-0.5 opacity-0 transition group-hover:opacity-100 hover:bg-background"
                  title="移除"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        {uploadError && (
          <div className="mb-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
            {uploadError}
          </div>
        )}

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragActive(true);
          }}
          onDragEnter={(e) => {
            e.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={handleDrop}
          className={cn(
            "flex items-end gap-2 rounded-2xl border border-border bg-background p-2 shadow-sm transition focus-within:shadow-focus",
            dragActive && "border-primary/60 ring-2 ring-primary/15",
          )}
        >
          <input
            ref={fileInputRef}
            id={fileInputId}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files) addFiles(e.target.files);
              // 清空 input.value,使下次选同一文件也能再次触发 change
              e.target.value = "";
            }}
          />
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="text-muted-foreground hover:text-foreground"
            title={`贴一张题目图片 (最多 ${MAX_IMAGES} 张 · ≤ ${MAX_BYTES / 1024 / 1024}MB)`}
            disabled={disabled || images.length >= MAX_IMAGES}
            onClick={() => fileInputRef.current?.click()}
          >
            <ImagePlus className="h-4 w-4" />
          </Button>
          {/* Phase 5.5: 联网搜索 toggle */}
          {onWebSearchChange && (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className={cn(
                "transition",
                webSearchAvailable
                  ? webSearch
                    ? "bg-primary/10 text-primary hover:bg-primary/15"
                    : "text-muted-foreground hover:text-foreground"
                  : "text-muted-foreground/40",
              )}
              title={
                !webSearchAvailable
                  ? "联网搜索未启用 (后端未配置 TAVILY_API_KEY)"
                  : webSearch
                    ? "联网搜索:开 — 本条提问会先用 Tavily 搜实时网页"
                    : "联网搜索:关 — 点击开启,获取实时网页材料"
              }
              disabled={disabled || !webSearchAvailable}
              onClick={() => onWebSearchChange(!webSearch)}
              aria-pressed={webSearch}
              aria-label="联网搜索"
            >
              <Globe className="h-4 w-4" />
            </Button>
          )}
          <Textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={
              images.length > 0
                ? "再补充几句话?(可留空,Enter 直接发图)"
                : `和 ${agent.displayName} 说点什么…  Enter 发送 · 可拖入/粘贴题目截图`
            }
            rows={1}
            className="max-h-[200px] min-h-[44px] resize-none border-0 bg-transparent p-2 shadow-none focus-visible:ring-0"
          />
          {disabled ? (
            <Button
              size="icon"
              variant="secondary"
              onClick={onStop}
              title="停止生成"
              disabled={!onStop}
            >
              <Square className="h-4 w-4" />
            </Button>
          ) : (
            <Button
              size="icon"
              onClick={submit}
              title={
                stillUploading
                  ? "图片上传中…"
                  : "发送 (Enter)"
              }
              disabled={
                stillUploading ||
                (!value.trim() && readyImages.length === 0)
              }
            >
              {stillUploading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          )}
        </div>
        <p className="mt-2 flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
          {webSearch && webSearchAvailable && (
            <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
              <Globe className="h-2.5 w-2.5" />
              联网搜索 · 开
            </span>
          )}
          <span>AI 老师可能会犯错。重要的题目记得自己再验证一遍 🙂</span>
        </p>
      </div>
    </div>
  );
}
