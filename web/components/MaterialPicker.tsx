"use client";

import { Check, FileText, Library, Loader2, Paperclip, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import type { Material } from "@/lib/types";
import { cn } from "@/lib/utils";

interface MaterialPickerProps {
  materials: Material[];
  isLoading?: boolean;
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}

export function MaterialPicker({
  materials,
  isLoading,
  selectedIds,
  onChange,
}: MaterialPickerProps) {
  const [open, setOpen] = useState(false);
  const ready = materials.filter((m) => m.parse_status === "ready");
  const selectedSet = new Set(selectedIds);

  function toggle(id: string) {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(Array.from(next));
  }

  function clear() {
    onChange([]);
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        正在加载资料库…
      </div>
    );
  }

  if (ready.length === 0) {
    return (
      <Link
        href="/materials"
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition hover:text-primary"
      >
        <Paperclip className="h-3 w-3" />
        想让老师基于你的资料回答? 先去
        <span className="underline underline-offset-2">资料库</span>
        上传一份
      </Link>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs transition",
            selectedIds.length > 0
              ? "bg-primary/10 text-primary"
              : "bg-secondary text-secondary-foreground hover:bg-secondary/80",
          )}
        >
          <Paperclip className="h-3 w-3" />
          引用资料
          {selectedIds.length > 0 ? (
            <span className="ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] text-primary-foreground">
              {selectedIds.length}
            </span>
          ) : null}
        </button>

        {/* 已选 chips 概览 */}
        {selectedIds.length > 0 &&
          ready
            .filter((m) => selectedSet.has(m.id))
            .slice(0, 3)
            .map((m) => (
              <span
                key={m.id}
                className="inline-flex max-w-[220px] items-center gap-1 truncate rounded-full bg-primary/5 px-2.5 py-1 text-[11px] text-primary"
              >
                <FileText className="h-3 w-3 shrink-0" />
                <span className="truncate">{m.title}</span>
                <button
                  type="button"
                  className="ml-0.5 -mr-0.5 rounded-full p-0.5 hover:bg-primary/10"
                  onClick={() => toggle(m.id)}
                  aria-label="取消引用"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
        {selectedIds.length > 3 && (
          <span className="text-[11px] text-muted-foreground">
            ...还有 {selectedIds.length - 3} 份
          </span>
        )}
        {selectedIds.length > 0 && (
          <button
            type="button"
            onClick={clear}
            className="ml-1 text-[11px] text-muted-foreground hover:text-destructive"
          >
            清空
          </button>
        )}
      </div>

      {open && (
        <div className="max-h-60 overflow-y-auto rounded-xl border border-border/70 bg-background/95 p-2 shadow-card scrollbar-thin">
          <div className="mb-2 flex items-center justify-between px-1.5 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <Library className="h-3 w-3" />
              你的资料库 (勾选若干份让老师基于它们回答)
            </span>
            <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => setOpen(false)}>
              收起
            </Button>
          </div>
          <ul className="space-y-0.5">
            {ready.map((m) => {
              const checked = selectedSet.has(m.id);
              return (
                <li key={m.id}>
                  <button
                    type="button"
                    onClick={() => toggle(m.id)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition hover:bg-secondary",
                      checked && "bg-primary/5",
                    )}
                  >
                    <span
                      className={cn(
                        "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                        checked
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border bg-background",
                      )}
                    >
                      {checked ? <Check className="h-3 w-3" /> : null}
                    </span>
                    <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="flex-1 truncate" title={m.title}>
                      {m.title}
                    </span>
                    <span className="shrink-0 text-[10px] text-muted-foreground">
                      {m.chunk_count} 段
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="mt-2 border-t border-border/60 px-1.5 pt-2 text-right">
            <Link
              href="/materials"
              className="text-[11px] text-primary hover:underline"
            >
              管理资料库 →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
