"use client";

/**
 * Phase 8 · UpgradeGate — 全局的"额度已用完 / 需升级"弹窗.
 *
 * 工作方式:
 *   - api.ts 里 QuotaError 抛出前会 window.dispatchEvent("quota-exceeded", detail)
 *   - 本组件挂在 <Providers> 里, 全局只有一份
 *   - 收到事件 → 弹窗展示 message + upgrade_hint + "去查看套餐" 按钮
 *
 * 不需要任何 context, 因为业务代码只关心 "能不能操作", 不需要感知 gate.
 */

import { Sparkles, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import type { QuotaExceededDetail } from "@/lib/types";

export function UpgradeGate() {
  const [detail, setDetail] = useState<QuotaExceededDetail | null>(null);

  useEffect(() => {
    function onQuota(e: Event) {
      const ce = e as CustomEvent<QuotaExceededDetail>;
      if (ce.detail) setDetail(ce.detail);
    }
    window.addEventListener("quota-exceeded", onQuota);
    return () => window.removeEventListener("quota-exceeded", onQuota);
  }, []);

  // ESC 关闭
  useEffect(() => {
    if (!detail) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setDetail(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [detail]);

  if (!detail) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="upgrade-gate-title"
      className="fixed inset-0 z-[80] flex items-center justify-center p-4"
    >
      <button
        type="button"
        aria-label="关闭"
        onClick={() => setDetail(null)}
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
      />
      <div className="relative w-full max-w-md overflow-hidden rounded-2xl border border-border bg-background shadow-2xl">
        {/* 顶部渐变 banner */}
        <div className="bg-gradient-to-br from-primary/15 via-primary/5 to-transparent px-6 py-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <h3
                id="upgrade-gate-title"
                className="text-lg font-semibold leading-tight"
              >
                升级到 Pro 版
              </h3>
              <p className="text-xs text-muted-foreground">
                {formatKey(detail.limit_key)} 已达免费上限
              </p>
            </div>
            <button
              type="button"
              onClick={() => setDetail(null)}
              className="ml-auto rounded-full p-1 text-muted-foreground transition hover:bg-secondary hover:text-foreground"
              aria-label="关闭"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="space-y-4 px-6 py-5">
          <p className="text-sm">{detail.message}</p>

          <div className="rounded-lg border border-border bg-secondary/40 p-3 text-xs">
            <div className="flex justify-between">
              <span className="text-muted-foreground">额度项</span>
              <span className="font-mono">{detail.limit_key}</span>
            </div>
            <div className="mt-1 flex justify-between">
              <span className="text-muted-foreground">已使用 / 上限</span>
              <span className="font-mono">
                {String(detail.used)} / {String(detail.limit ?? "∞")}
              </span>
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            {detail.upgrade_hint}
          </p>

          <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
            <Button
              variant="ghost"
              onClick={() => setDetail(null)}
              className="sm:w-auto"
            >
              以后再说
            </Button>
            <Link
              href="/settings/plan"
              onClick={() => setDetail(null)}
              className="inline-flex items-center justify-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition hover:opacity-90"
            >
              <Sparkles className="h-4 w-4" />
              查看我的套餐
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

function formatKey(k: string): string {
  const map: Record<string, string> = {
    chat_messages_per_day: "今日对话消息",
    materials_total: "资料库文件",
    groups_created_total: "创建群组",
    practice_sessions_per_day: "今日练习会话",
    lecture_notes_per_day: "今日听课笔记",
    allowed_model_tiers: "高级模型档位",
  };
  return map[k] ?? k;
}
