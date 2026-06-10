"use client";

import { Check, ChevronDown, Cpu, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";
import type { ModelTierId, ModelTierInfo } from "@/lib/types";

interface ModelSelectorProps {
  tiers: ModelTierInfo[] | undefined;
  /** 当前选中的 tier id (受控) */
  value: ModelTierId | null;
  /** null = 用 agent 默认 */
  onChange: (tier: ModelTierId) => void;
  disabled?: boolean;
}

const TIER_ORDER: ModelTierId[] = ["low", "medium", "high", "extra_high", "max"];

/** 紧凑下拉:学生在对话里点击"medium · gpt-4o-mini ▾"展开 5 档选择 */
export function ModelSelector({
  tiers,
  value,
  onChange,
  disabled,
}: ModelSelectorProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // 点击外部关闭
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  // 加载中骨架
  if (!tiers || tiers.length === 0) {
    return (
      <div className="inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary px-2.5 py-1 text-[11px] text-muted-foreground">
        <Cpu className="h-3 w-3" />
        正在加载模型…
      </div>
    );
  }

  // 按 TIER_ORDER 排序;若后端返回未知 tier,放最后
  const sortedTiers = [...tiers].sort((a, b) => {
    const ai = TIER_ORDER.indexOf(a.tier);
    const bi = TIER_ORDER.indexOf(b.tier);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });

  const defaultTier =
    sortedTiers.find((t) => t.is_default) ?? sortedTiers[1] ?? sortedTiers[0];
  const current =
    sortedTiers.find((t) => t.tier === value) ?? defaultTier;
  const isExplicit = value !== null && value !== undefined;

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition",
          isExplicit
            ? "border-primary/30 bg-primary/10 text-primary hover:bg-primary/15"
            : "border-border bg-secondary text-muted-foreground hover:bg-secondary/70 hover:text-foreground",
          disabled && "cursor-not-allowed opacity-60",
        )}
        title={`当前模型:${current.display} · ${current.model}`}
      >
        <Cpu className="h-3 w-3" />
        <span className="font-medium">{current.display}</span>
        <span className="hidden font-mono text-muted-foreground/90 sm:inline">
          · {current.model}
        </span>
        {!isExplicit && current.is_default && (
          <span className="hidden rounded-full bg-background/60 px-1.5 py-px text-[9px] text-muted-foreground sm:inline">
            默认
          </span>
        )}
        <ChevronDown
          className={cn(
            "h-3 w-3 transition",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1.5 w-[320px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-border bg-card shadow-card">
          <div className="border-b border-border/60 px-3 py-2 text-[11px] text-muted-foreground">
            选择本次对话使用的 AI 模型
          </div>
          <ul className="max-h-[60vh] overflow-y-auto py-1 scrollbar-thin">
            {sortedTiers.map((t) => {
              const active = t.tier === current.tier;
              return (
                <li key={t.tier}>
                  <button
                    type="button"
                    onClick={() => {
                      onChange(t.tier);
                      setOpen(false);
                    }}
                    className={cn(
                      "flex w-full items-start gap-2 px-3 py-2 text-left transition hover:bg-secondary",
                      active && "bg-primary/5",
                    )}
                  >
                    <span
                      className={cn(
                        "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
                        active
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border bg-background",
                      )}
                    >
                      {active && <Check className="h-2.5 w-2.5" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-semibold">
                          {t.display}
                        </span>
                        {t.is_default && (
                          <span className="rounded-full bg-secondary px-1.5 py-px text-[9px] text-muted-foreground">
                            默认
                          </span>
                        )}
                        {(t.tier === "extra_high" || t.tier === "max") && (
                          <span className="inline-flex items-center gap-0.5 rounded-full bg-primary/10 px-1.5 py-px text-[9px] text-primary">
                            <Sparkles className="h-2 w-2" />
                            推理
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 flex items-center gap-3 text-[10px] text-muted-foreground">
                        <span className="font-mono">{t.model}</span>
                        <DotMeter label="能力" value={t.capability} max={6} />
                        <DotMeter
                          label="开销"
                          value={t.cost}
                          max={10}
                          variant="cost"
                        />
                      </div>
                      <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">
                        {t.desc}
                      </p>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="border-t border-border/60 px-3 py-2 text-[10px] text-muted-foreground">
            提示:推理模型需 OpenAI 账号开通对应权限。设置项见
            <code className="mx-1 rounded bg-secondary px-1">.env</code>
            中的 <code className="rounded bg-secondary px-1">OPENAI_CHAT_MODEL_*</code>
          </div>
        </div>
      )}
    </div>
  );
}

function DotMeter({
  label,
  value,
  max,
  variant = "capability",
}: {
  label: string;
  value: number;
  max: number;
  variant?: "capability" | "cost";
}) {
  const clamped = Math.max(0, Math.min(max, value));
  return (
    <span className="inline-flex items-center gap-0.5">
      <span className="text-muted-foreground/70">{label}</span>
      <span className="inline-flex gap-[1px]">
        {Array.from({ length: max }).map((_, i) => (
          <span
            key={i}
            className={cn(
              "block h-1 w-1 rounded-full",
              i < clamped
                ? variant === "cost"
                  ? "bg-amber-500/70"
                  : "bg-primary"
                : "bg-muted-foreground/20",
            )}
          />
        ))}
      </span>
    </span>
  );
}
