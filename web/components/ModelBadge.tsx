"use client";

import { Sparkles } from "lucide-react";

import { cn } from "@/lib/utils";

interface ModelBadgeProps {
  /** 模型名,例如 gpt-4o-mini / text-embedding-3-small */
  model: string;
  /** 左侧前缀文字 (可选),如 "对话由" 或 "向量化:" */
  label?: string;
  size?: "xs" | "sm";
  tone?: "primary" | "muted" | "inverse";
  className?: string;
}

/**
 * 显式标注当前 AI 触点使用的模型,让用户感知 AI 是真在工作。
 *
 * 用法示例:
 *   <ModelBadge model="gpt-4o-mini" />                  // 默认 primary
 *   <ModelBadge model="text-embedding-3-small" label="向量化" tone="muted" />
 */
export function ModelBadge({
  model,
  label,
  size = "xs",
  tone = "primary",
  className,
}: ModelBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border font-medium",
        size === "xs" ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-xs",
        tone === "primary" &&
          "border-primary/15 bg-primary/5 text-primary",
        tone === "muted" &&
          "border-border bg-secondary text-muted-foreground",
        tone === "inverse" &&
          "border-background/15 bg-background/10 text-background",
        className,
      )}
    >
      <Sparkles className={cn("shrink-0", size === "xs" ? "h-3 w-3" : "h-3.5 w-3.5")} />
      {label && <span>{label}</span>}
      <span className="font-mono tracking-tight">{model}</span>
    </span>
  );
}
