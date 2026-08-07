"use client";

import { Gamepad2, Info } from "lucide-react";
import { useState } from "react";

import { AppHeader } from "@/components/AppHeader";
import { WidgetRenderer } from "@/components/widgets/WidgetRenderer";
import { DOMAINS, WIDGETS } from "@/lib/widgets/registry";
import { cn } from "@/lib/utils";

/**
 * 训练台：按学习目标（领域）加载对应的交互练习界面。
 * 每个领域是一份 widget manifest，由 WidgetRenderer 动态、按需组装。
 */
export default function WidgetsPage() {
  const [domainKey, setDomainKey] = useState(DOMAINS[0].key);
  const domain = DOMAINS.find((d) => d.key === domainKey) ?? DOMAINS[0];

  return (
    <div className="min-h-dvh bg-app-gradient">
      <AppHeader />
      <main className="container space-y-6 py-8">
        <header className="space-y-2">
          <div className="flex items-center gap-2">
            <Gamepad2 className="h-5 w-5 text-primary" />
            <h1 className="text-2xl font-semibold tracking-tight">训练台</h1>
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
              Beta
            </span>
          </div>
          <p className="max-w-2xl text-sm text-muted-foreground">
            针对不同学习目标，加载最合适的交互练习界面。每套界面都由可复用组件动态组装而成。
          </p>
        </header>

        {/* 领域选择器 */}
        <div className="flex flex-wrap gap-2">
          {DOMAINS.map((d) => (
            <button
              key={d.key}
              type="button"
              onClick={() => setDomainKey(d.key)}
              className={cn(
                "flex flex-col items-start rounded-2xl border px-4 py-2.5 text-left transition",
                d.key === domainKey
                  ? "border-primary bg-primary/5"
                  : "border-border bg-card hover:border-primary/40",
              )}
            >
              <span className="text-sm font-semibold">{d.label}</span>
              <span className="text-[11px] text-muted-foreground">
                {d.tagline}
              </span>
            </button>
          ))}
        </div>

        <div className="flex items-start gap-2 rounded-2xl border border-primary/15 bg-primary/5 px-4 py-3 text-sm">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <div className="text-muted-foreground">
            「{domain.label}」由这些组件动态加载：
            {domain.widgets.map((t, i) => (
              <span key={t}>
                {i > 0 && "、"}
                <span className="font-medium text-foreground">
                  {WIDGETS[t].title}
                </span>
              </span>
            ))}
            。每个组件按需懒加载、互不耦合，可被任意学习目标复用。
          </div>
        </div>

        {/* manifest 驱动的组装：多列瀑布流自适应 */}
        <div className="columns-1 gap-6 [column-fill:balance] lg:columns-2">
          {domain.widgets.map((t) => (
            <div key={t} className="mb-6 break-inside-avoid">
              <WidgetRenderer type={t} />
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
