"use client";

/**
 * Phase 7.1: 产品后台看板
 *
 * 非 admin 用户会被 403 拦下, 前端显示 "无权访问" 页面.
 * 数据来自 /api/admin/*, 走 ADMIN_EMAILS 白名单.
 */

export const dynamic = "force-dynamic";

import { useQuery } from "@tanstack/react-query";
import {
  BookOpen,
  FileText,
  Loader2,
  MessageSquare,
  Notebook,
  Target,
  Users,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, type ReactNode } from "react";

import { AppHeader } from "@/components/AppHeader";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { adminApi } from "@/lib/api";
import { cn } from "@/lib/utils";
import type {
  AdminBreakdown,
  AdminBreakdownItem,
  AdminTrendPoint,
} from "@/lib/types";

export default function AdminPage() {
  const router = useRouter();
  const meQuery = useQuery({
    queryKey: ["admin-me"],
    queryFn: adminApi.me,
    staleTime: 60_000,
  });

  const isAdmin = meQuery.data?.is_admin === true;

  const overview = useQuery({
    queryKey: ["admin-overview"],
    queryFn: adminApi.overview,
    enabled: isAdmin,
    refetchInterval: 60_000,
  });
  const trend = useQuery({
    queryKey: ["admin-trend", 30],
    queryFn: () => adminApi.trend(30),
    enabled: isAdmin,
    staleTime: 60_000,
  });
  const breakdown = useQuery({
    queryKey: ["admin-breakdown"],
    queryFn: adminApi.breakdown,
    enabled: isAdmin,
    staleTime: 60_000,
  });
  const users = useQuery({
    queryKey: ["admin-users", 50],
    queryFn: () => adminApi.users(50),
    enabled: isAdmin,
    staleTime: 60_000,
  });
  const top = useQuery({
    queryKey: ["admin-top-users", 10],
    queryFn: () => adminApi.topUsers(10),
    enabled: isAdmin,
    staleTime: 60_000,
  });

  if (meQuery.isLoading) {
    return (
      <div className="min-h-dvh bg-app-gradient">
        <AppHeader />
        <div className="container flex items-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          正在检查权限…
        </div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="min-h-dvh bg-app-gradient">
        <AppHeader />
        <main className="container max-w-lg space-y-4 py-16 text-center">
          <h1 className="text-2xl font-semibold">无权访问</h1>
          <p className="text-sm text-muted-foreground">
            这个页面仅平台管理员可见。当前登录邮箱{" "}
            <span className="font-mono">{meQuery.data?.email ?? "?"}</span>{" "}
            不在管理员白名单里。
          </p>
          <button
            onClick={() => router.push("/dashboard")}
            className="mt-4 text-sm text-primary hover:underline"
          >
            返回主页
          </button>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-app-gradient">
      <AppHeader />
      <main className="container max-w-6xl space-y-8 py-6">
        {/* 标题 */}
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">产品后台看板</h1>
            <p className="text-sm text-muted-foreground">
              实时使用数据 · 每 60 秒自动刷新
            </p>
          </div>
          <Badge variant="secondary">
            {meQuery.data?.email} · 管理员
          </Badge>
        </header>

        {/* ─── Stat cards ─────────────────────────────── */}
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            用户
          </h2>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard
              icon={<Users className="h-4 w-4" />}
              label="总注册用户"
              value={overview.data?.users.total ?? "—"}
              loading={overview.isLoading}
            />
            <StatCard
              label="今日活跃"
              value={overview.data?.users.active_today ?? "—"}
              loading={overview.isLoading}
              accent
            />
            <StatCard
              label="近 7 天活跃"
              value={overview.data?.users.active_week ?? "—"}
              loading={overview.isLoading}
            />
            <StatCard
              label="近 30 天活跃"
              value={overview.data?.users.active_month ?? "—"}
              loading={overview.isLoading}
            />
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            内容
          </h2>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard
              icon={<MessageSquare className="h-4 w-4" />}
              label="对话消息 (总)"
              value={overview.data?.content.chat_messages_total ?? "—"}
              hint={
                overview.data
                  ? `今日 +${overview.data.content.chat_messages_today}`
                  : undefined
              }
              loading={overview.isLoading}
            />
            <StatCard
              icon={<Notebook className="h-4 w-4" />}
              label="笔记"
              value={overview.data?.content.notes_total ?? "—"}
              loading={overview.isLoading}
            />
            <StatCard
              icon={<FileText className="h-4 w-4" />}
              label="学生上传资料"
              value={overview.data?.content.materials_student_total ?? "—"}
              hint={
                overview.data
                  ? `含平台共 ${overview.data.content.materials_total}`
                  : undefined
              }
              loading={overview.isLoading}
            />
            <StatCard
              icon={<Target className="h-4 w-4" />}
              label="练习会话"
              value={overview.data?.content.practice_sessions_total ?? "—"}
              loading={overview.isLoading}
            />
            <StatCard
              icon={<Users className="h-4 w-4" />}
              label="群组"
              value={overview.data?.content.groups_total ?? "—"}
              hint={
                overview.data
                  ? `${overview.data.content.group_members_total} 人次加入`
                  : undefined
              }
              loading={overview.isLoading}
            />
            <StatCard
              icon={<BookOpen className="h-4 w-4" />}
              label="对话会话"
              value={overview.data?.content.chat_sessions_total ?? "—"}
              loading={overview.isLoading}
            />
          </div>
        </section>

        {/* ─── Trend ─────────────────────────────────── */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            近 30 天趋势
          </h2>
          {trend.isLoading ? (
            <SkeletonBlock />
          ) : trend.data ? (
            <TrendChart data={trend.data.series} />
          ) : (
            <EmptyBlock text="加载失败" />
          )}
        </section>

        {/* ─── Breakdown ──────────────────────────────── */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            分布 · 内容/使用来源
          </h2>
          {breakdown.data && <BreakdownGrid data={breakdown.data} />}
        </section>

        {/* ─── Top users ──────────────────────────────── */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            近 30 天最活跃用户 Top 10
          </h2>
          <Card>
            <CardContent className="p-0">
              <TopUsersTable
                loading={top.isLoading}
                users={top.data?.users ?? []}
              />
            </CardContent>
          </Card>
        </section>

        {/* ─── Recent users ──────────────────────────── */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            最近注册的 50 位用户
          </h2>
          <Card>
            <CardContent className="p-0">
              <RecentUsersTable
                loading={users.isLoading}
                users={users.data?.users ?? []}
              />
            </CardContent>
          </Card>
        </section>
      </main>
    </div>
  );
}

// -----------------------------------------------------------------------------
// StatCard
// -----------------------------------------------------------------------------
function StatCard({
  icon,
  label,
  value,
  hint,
  loading,
  accent,
}: {
  icon?: ReactNode;
  label: string;
  value: string | number;
  hint?: string;
  loading?: boolean;
  accent?: boolean;
}) {
  return (
    <Card
      className={cn(accent ? "border-primary/40 bg-primary/5" : undefined)}
    >
      <CardContent className="space-y-1 p-4">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {icon}
          <span>{label}</span>
        </div>
        <div
          className={cn(
            "text-2xl font-semibold tabular-nums",
            accent ? "text-primary" : undefined,
          )}
        >
          {loading ? (
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          ) : (
            value
          )}
        </div>
        {hint && <div className="text-[11px] text-muted-foreground">{hint}</div>}
      </CardContent>
    </Card>
  );
}

// -----------------------------------------------------------------------------
// TrendChart — 纯 SVG 3 系列折线 (不引外部图表库, 保持轻量)
// -----------------------------------------------------------------------------
function TrendChart({ data }: { data: AdminTrendPoint[] }) {
  const W = 900;
  const H = 220;
  const P = { l: 40, r: 20, t: 20, b: 30 };
  const innerW = W - P.l - P.r;
  const innerH = H - P.t - P.b;

  const maxY = Math.max(
    1,
    ...data.map((d) => Math.max(d.new_users, d.messages, d.notes)),
  );
  const stepX = data.length > 1 ? innerW / (data.length - 1) : 0;
  const y = (v: number) => P.t + innerH - (v / maxY) * innerH;
  const x = (i: number) => P.l + i * stepX;

  const path = (key: keyof AdminTrendPoint) =>
    data
      .map((d, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(Number(d[key])).toFixed(1)}`)
      .join(" ");

  const series: {
    key: keyof AdminTrendPoint;
    label: string;
    color: string;
  }[] = [
    { key: "messages", label: "对话消息", color: "hsl(217 91% 60%)" },
    { key: "notes", label: "新增笔记", color: "hsl(142 76% 36%)" },
    { key: "new_users", label: "新增用户", color: "hsl(24 95% 53%)" },
  ];

  // 只在开头 / 结尾 / 中间标 3 个日期避免拥挤
  const ticks = [
    { i: 0, d: data[0]?.date },
    { i: Math.floor(data.length / 2), d: data[Math.floor(data.length / 2)]?.date },
    { i: data.length - 1, d: data[data.length - 1]?.date },
  ].filter((t) => t.d);

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        {/* 图例 */}
        <div className="flex flex-wrap items-center gap-4 text-xs">
          {series.map((s) => (
            <div key={s.key} className="flex items-center gap-1.5">
              <span
                className="h-2 w-2 rounded-full"
                style={{ background: s.color }}
              />
              <span className="text-muted-foreground">{s.label}</span>
            </div>
          ))}
        </div>
        <div className="overflow-x-auto">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="min-w-[600px] w-full"
            role="img"
            aria-label="近 30 天趋势"
          >
            {/* Y 轴 grid */}
            {[0.25, 0.5, 0.75, 1].map((f) => (
              <line
                key={f}
                x1={P.l}
                x2={W - P.r}
                y1={y(maxY * f)}
                y2={y(maxY * f)}
                stroke="currentColor"
                strokeOpacity={0.08}
              />
            ))}
            {/* Y axis 刻度值 */}
            {[0.25, 0.5, 0.75, 1].map((f) => (
              <text
                key={f}
                x={P.l - 6}
                y={y(maxY * f) + 3}
                textAnchor="end"
                fontSize="10"
                fill="currentColor"
                opacity="0.5"
              >
                {Math.round(maxY * f)}
              </text>
            ))}
            {/* 折线 */}
            {series.map((s) => (
              <path
                key={s.key}
                d={path(s.key)}
                fill="none"
                stroke={s.color}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ))}
            {/* X 轴日期 */}
            {ticks.map((t) => (
              <text
                key={t.i}
                x={x(t.i)}
                y={H - 8}
                textAnchor={t.i === 0 ? "start" : t.i === data.length - 1 ? "end" : "middle"}
                fontSize="10"
                fill="currentColor"
                opacity="0.5"
              >
                {t.d?.slice(5) /* MM-DD */}
              </text>
            ))}
          </svg>
        </div>
      </CardContent>
    </Card>
  );
}

// -----------------------------------------------------------------------------
// Breakdown
// -----------------------------------------------------------------------------
function BreakdownGrid({ data }: { data: AdminBreakdown }) {
  const sections: { title: string; items: AdminBreakdownItem[]; total: number }[] =
    useMemo(() => {
      const s = [
        { title: "笔记来源", items: data.notes_by_source },
        { title: "资料类型", items: data.materials_by_type },
        { title: "对话消息 · 老师 Top 10", items: data.messages_by_agent },
        { title: "群组公开性", items: data.groups_by_visibility },
        { title: "练习状态", items: data.practice_by_status },
        { title: "资料归属", items: data.materials_by_owner_type },
      ];
      return s
        .filter((x) => x.items.length > 0)
        .map((x) => ({
          ...x,
          total: x.items.reduce((a, b) => a + b.count, 0),
        }));
    }, [data]);

  if (sections.length === 0) {
    return <EmptyBlock text="还没有内容数据" />;
  }
  return (
    <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
      {sections.map((s) => (
        <Card key={s.title}>
          <CardContent className="space-y-2 p-4">
            <div className="flex items-baseline justify-between">
              <span className="text-sm font-semibold">{s.title}</span>
              <span className="text-xs text-muted-foreground">
                合计 {s.total}
              </span>
            </div>
            <ul className="space-y-1.5">
              {s.items.slice(0, 8).map((it) => {
                const pct = s.total > 0 ? (it.count / s.total) * 100 : 0;
                return (
                  <li key={it.key} className="space-y-0.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="truncate">{prettyKey(it.key)}</span>
                      <span className="tabular-nums text-muted-foreground">
                        {it.count} · {pct.toFixed(0)}%
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
                      <div
                        className="h-full rounded-full bg-primary/60"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function prettyKey(k: string): string {
  const map: Record<string, string> = {
    chat: "对话蒸馏",
    manual: "手写",
    lecture: "听课",
    practice: "练习",
    imported: "导入",
    student: "学生上传",
    platform: "平台",
    textbook: "课本",
    handout: "讲义",
    homework: "作业",
    exam: "试卷",
    note: "笔记",
    wrong_question: "错题",
    other: "其他",
    True: "公开",
    False: "私密",
    true: "公开",
    false: "私密",
    active: "进行中",
    completed: "已完成",
    abandoned: "已放弃",
    head_teacher: "AI 班主任",
    math_teacher: "数学老师",
    english_teacher: "英语老师",
    chinese_teacher: "语文老师",
    "(unknown)": "(未知)",
  };
  return map[k] ?? k;
}

// -----------------------------------------------------------------------------
// Users tables
// -----------------------------------------------------------------------------
function TopUsersTable({
  loading,
  users,
}: {
  loading?: boolean;
  users: import("@/lib/types").AdminTopUser[];
}) {
  if (loading) return <SkeletonRows n={6} />;
  if (users.length === 0)
    return <EmptyBlock text="近 30 天暂无活跃用户" />;
  return (
    <table className="w-full text-sm">
      <thead className="border-b border-border bg-secondary/40 text-xs text-muted-foreground">
        <tr>
          <th className="px-4 py-2 text-left">#</th>
          <th className="px-4 py-2 text-left">用户</th>
          <th className="px-4 py-2 text-left">年级</th>
          <th className="px-4 py-2 text-right">30 天消息数</th>
        </tr>
      </thead>
      <tbody>
        {users.map((u, i) => (
          <tr key={u.user_id} className="border-b border-border/40 last:border-0">
            <td className="px-4 py-2 tabular-nums text-muted-foreground">{i + 1}</td>
            <td className="px-4 py-2">
              <div className="font-medium">
                {u.display_name || u.email || u.user_id.slice(0, 8)}
              </div>
              {u.email && u.display_name && (
                <div className="text-xs text-muted-foreground">{u.email}</div>
              )}
            </td>
            <td className="px-4 py-2 text-muted-foreground">{u.grade ?? "—"}</td>
            <td className="px-4 py-2 text-right tabular-nums font-semibold">
              {u.messages_30d}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function RecentUsersTable({
  loading,
  users,
}: {
  loading?: boolean;
  users: import("@/lib/types").AdminUserRow[];
}) {
  if (loading) return <SkeletonRows n={10} />;
  if (users.length === 0) return <EmptyBlock text="还没有用户" />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-sm">
        <thead className="border-b border-border bg-secondary/40 text-xs text-muted-foreground">
          <tr>
            <th className="px-4 py-2 text-left">用户</th>
            <th className="px-4 py-2 text-left">年级/学校</th>
            <th className="px-4 py-2 text-left">学习目标</th>
            <th className="px-4 py-2 text-right">消息</th>
            <th className="px-4 py-2 text-right">笔记</th>
            <th className="px-4 py-2 text-right">资料</th>
            <th className="px-4 py-2 text-left">注册</th>
            <th className="px-4 py-2 text-left">最近登录</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.user_id} className="border-b border-border/40 last:border-0">
              <td className="px-4 py-2">
                <div className="font-medium">
                  {u.display_name || u.email || u.user_id.slice(0, 8)}
                </div>
                {u.display_name && u.email && (
                  <div className="text-xs text-muted-foreground">{u.email}</div>
                )}
              </td>
              <td className="px-4 py-2 text-muted-foreground">
                <div>{u.grade ?? "—"}</div>
                {u.school && (
                  <div className="text-xs text-muted-foreground/70">{u.school}</div>
                )}
              </td>
              <td className="max-w-[220px] px-4 py-2 text-xs text-muted-foreground">
                <div className="truncate" title={u.learning_goal ?? ""}>
                  {u.learning_goal ?? "—"}
                </div>
              </td>
              <td className="px-4 py-2 text-right tabular-nums">{u.messages}</td>
              <td className="px-4 py-2 text-right tabular-nums">{u.notes}</td>
              <td className="px-4 py-2 text-right tabular-nums">{u.materials}</td>
              <td className="whitespace-nowrap px-4 py-2 text-xs text-muted-foreground">
                {u.created_at ? new Date(u.created_at).toLocaleDateString("zh-CN") : "—"}
              </td>
              <td className="whitespace-nowrap px-4 py-2 text-xs text-muted-foreground">
                {u.last_sign_in_at
                  ? new Date(u.last_sign_in_at).toLocaleDateString("zh-CN")
                  : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Small helpers
// -----------------------------------------------------------------------------
function SkeletonBlock() {
  return <div className="h-52 animate-pulse rounded-2xl border border-border bg-card" />;
}
function SkeletonRows({ n = 4 }: { n?: number }) {
  return (
    <div className="p-4">
      {Array.from({ length: n }).map((_, i) => (
        <div
          key={i}
          className="mb-2 h-8 animate-pulse rounded-md bg-secondary/60 last:mb-0"
        />
      ))}
    </div>
  );
}
function EmptyBlock({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-background/40 px-4 py-8 text-center text-sm text-muted-foreground">
      {text}
    </div>
  );
}
