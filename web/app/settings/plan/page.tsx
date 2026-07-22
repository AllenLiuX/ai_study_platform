"use client";

/**
 * Phase 8 · /settings/plan — 我的套餐 + 用量.
 *
 * - Free: 展示今日已用 / 上限 (进度条) + "如何升级"
 * - Pro:  展示到期时间 + 授予人 + note
 */

export const dynamic = "force-dynamic";

import { useQuery } from "@tanstack/react-query";
import { Check, Loader2, Sparkles } from "lucide-react";

import { AppHeader } from "@/components/AppHeader";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { billingApi } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { UsageItem } from "@/lib/types";

export default function PlanPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["my-plan"],
    queryFn: billingApi.myPlan,
    staleTime: 30_000,
  });

  return (
    <div className="min-h-dvh bg-app-gradient">
      <AppHeader />
      <main className="container max-w-3xl space-y-6 py-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">我的套餐</h1>
          <p className="text-sm text-muted-foreground">
            当前套餐、已用额度、以及升级说明
          </p>
        </header>

        {isLoading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> 加载中…
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            无法加载套餐信息: {(error as Error).message}
          </div>
        )}

        {data && (
          <>
            {/* 当前套餐大卡 */}
            <Card
              className={cn(
                data.is_pro
                  ? "border-amber-400/50 bg-gradient-to-br from-amber-50 via-background to-background"
                  : "",
              )}
            >
              <CardContent className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-lg font-semibold">
                      {data.is_pro ? "Pro 会员" : "免费版"}
                    </span>
                    {data.is_pro ? (
                      <Badge className="bg-amber-500 text-white hover:bg-amber-500">
                        <Sparkles className="mr-0.5 h-3 w-3" />
                        Pro
                      </Badge>
                    ) : (
                      <Badge variant="secondary">Free</Badge>
                    )}
                    {data.expired && (
                      <Badge variant="destructive">已过期</Badge>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {data.is_pro
                      ? data.expires_at
                        ? `Pro 会员到期时间: ${new Date(data.expires_at).toLocaleString("zh-CN")}`
                        : "Pro 会员 · 永久有效"
                      : "免费版有额度限制。如需解除限制, 请联系平台管理员开通 Pro."}
                  </p>
                  {data.note && (
                    <p className="text-xs text-muted-foreground/80">
                      备注: {data.note}
                    </p>
                  )}
                </div>
                {!data.is_pro && (
                  <div className="rounded-lg border border-primary/40 bg-primary/5 p-3 text-xs text-primary sm:max-w-[240px]">
                    <div className="font-semibold">如何升级 Pro?</div>
                    <p className="mt-1 leading-relaxed text-muted-foreground">
                      MVP 阶段 Pro 由管理员手动开通。
                      请把你注册使用的邮箱发给管理员, 我们会尽快为你开通。
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* 用量卡 */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">额度使用情况</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {data.usage.length === 0 && (
                  <p className="text-sm text-muted-foreground">暂无用量数据</p>
                )}
                {data.usage.map((u) => (
                  <UsageRow key={u.key} item={u} />
                ))}
                <div className="pt-2 text-xs text-muted-foreground">
                  <span className="font-medium">可用模型档位: </span>
                  {data.allowed_model_tiers.join(" · ")}
                  {!data.is_pro && (
                    <span className="ml-1 text-muted-foreground/70">
                      (Pro 可用 high / extra_high / max)
                    </span>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Free vs Pro 对比 */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">套餐对比</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-2">
                <PlanColumn
                  title="免费版"
                  price="¥0"
                  bullets={[
                    "每天 30 条 AI 对话",
                    "medium 及以下模型档",
                    "资料库最多 20 份",
                    "每天 5 次练习会话",
                    "每天 3 次听课笔记",
                    "可加入群组 (不能创建)",
                  ]}
                  current={!data.is_pro}
                />
                <PlanColumn
                  title="Pro 会员"
                  price="联系开通"
                  bullets={[
                    "AI 对话无上限",
                    "全模型档 (含 high / max)",
                    "资料库无限量",
                    "练习 / 听课 / 群组全部无限",
                    "优先支持新功能",
                  ]}
                  highlight
                  current={data.is_pro}
                />
              </CardContent>
            </Card>
          </>
        )}
      </main>
    </div>
  );
}

function UsageRow({ item }: { item: UsageItem }) {
  const pct =
    item.unlimited || !item.limit
      ? 0
      : Math.min(100, (item.used / item.limit) * 100);
  const nearLimit = pct >= 80 && !item.unlimited;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-sm">
        <span className="flex items-center gap-1.5">
          <span>{item.label}</span>
          <span className="rounded-full bg-secondary px-1.5 py-px text-[10px] uppercase tracking-wide text-muted-foreground">
            {item.period === "day" ? "24h" : "累计"}
          </span>
        </span>
        <span
          className={cn(
            "tabular-nums text-xs",
            item.exhausted
              ? "font-semibold text-destructive"
              : nearLimit
                ? "font-medium text-amber-600"
                : "text-muted-foreground",
          )}
        >
          {item.used} / {item.unlimited ? "∞" : item.limit}
        </span>
      </div>
      {!item.unlimited && (
        <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
          <div
            className={cn(
              "h-full transition-all",
              item.exhausted
                ? "bg-destructive"
                : nearLimit
                  ? "bg-amber-500"
                  : "bg-primary/60",
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  );
}

function PlanColumn({
  title,
  price,
  bullets,
  highlight,
  current,
}: {
  title: string;
  price: string;
  bullets: string[];
  highlight?: boolean;
  current?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex h-full flex-col rounded-xl border p-4",
        highlight
          ? "border-amber-400/60 bg-gradient-to-br from-amber-50/60 to-transparent"
          : "border-border",
      )}
    >
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-semibold">{title}</span>
        {current && (
          <Badge variant={highlight ? "default" : "secondary"}>
            当前套餐
          </Badge>
        )}
      </div>
      <div className="mt-1 text-2xl font-semibold">{price}</div>
      <ul className="mt-3 space-y-1.5 text-sm">
        {bullets.map((b) => (
          <li key={b} className="flex items-start gap-1.5">
            <Check
              className={cn(
                "mt-0.5 h-4 w-4 shrink-0",
                highlight ? "text-amber-600" : "text-primary/70",
              )}
            />
            <span>{b}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
