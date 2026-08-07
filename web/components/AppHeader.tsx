"use client";

import {
  Gamepad2,
  GraduationCap,
  Headphones,
  LayoutDashboard,
  Library,
  Loader2,
  LogOut,
  Map,
  MessageSquare,
  Notebook,
  Sparkles,
  Target,
  UserCog,
  Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { adminApi, chatApi } from "@/lib/api";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

interface AppHeaderProps {
  className?: string;
}

const NAV_LINKS = [
  { href: "/dashboard", label: "驾驶舱" },
  { href: "/roadmap", label: "规划", icon: Map },
  { href: "/agents", label: "老师", icon: GraduationCap },
  { href: "/practice", label: "练习", icon: Target },
  { href: "/widgets", label: "训练台", icon: Gamepad2 },
  { href: "/lecture", label: "听课", icon: Headphones },
  { href: "/materials", label: "资料库", icon: Library },
  { href: "/notes", label: "笔记", icon: Notebook },
  { href: "/groups", label: "群组", icon: Users },
] as const;

export function AppHeader({ className }: AppHeaderProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [email, setEmail] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    supabase.auth.getUser().then(({ data }) => {
      setEmail(data.user?.email ?? null);
    });
    // 管理入口必须以后端实时鉴权结果为准，不能使用跨账号的浏览器缓存。
    (async () => {
      try {
        const me = await adminApi.me();
        setIsAdmin(!!me.is_admin);
      } catch {
        setIsAdmin(false);
      }
    })();
  }, []);

  async function handleLogout() {
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  const chatActive = pathname?.startsWith("/chat") ?? false;

  const renderNavLinks = (compact = false) => (
    <>
      {NAV_LINKS.map((link) => {
        const active =
          link.href === "/dashboard"
            ? pathname === "/dashboard"
            : pathname?.startsWith(link.href);
        const Icon = "icon" in link ? link.icon : undefined;
        return (
          <Link
            key={link.href}
            href={link.href}
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-sm transition",
              compact && "px-3 py-1",
              active
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-secondary hover:text-foreground",
            )}
          >
            {Icon ? <Icon className="h-3.5 w-3.5" /> : null}
            {link.label}
          </Link>
        );
      })}
      <ChatNavButton active={chatActive} compact={compact} />
      {isAdmin && (
        <Link
          href="/admin"
          className={cn(
            "flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-sm transition",
            compact && "px-3 py-1",
            pathname?.startsWith("/admin")
              ? "bg-primary/10 text-primary"
              : "text-muted-foreground hover:bg-secondary hover:text-foreground",
          )}
          title="产品后台看板 (仅管理员可见)"
        >
          <LayoutDashboard className="h-3.5 w-3.5" />
          后台
        </Link>
      )}
    </>
  );

  return (
    <header
      className={cn(
        "sticky top-0 z-30 border-b border-border/60 bg-background/85 backdrop-blur",
        className,
      )}
    >
      <div className="container flex h-16 items-center justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-4">
          <Link
            href="/dashboard"
            className="flex shrink-0 items-center gap-2 min-w-0"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-foreground text-background">
              <Sparkles className="h-5 w-5" />
            </span>
            <div className="hidden flex-col leading-tight min-w-0 lg:flex">
              <span className="text-[15px] font-semibold tracking-tight truncate">
                AI 自适应学习平台
              </span>
              <span className="hidden text-[11px] text-muted-foreground xl:inline">
                Your adaptive AI tutor
              </span>
            </div>
          </Link>
          {/* 桌面导航:内容超宽时内部横向滚动,避免与右侧按钮重叠 */}
          <nav
            className={cn(
              "hidden min-w-0 flex-1 items-center gap-1 overflow-x-auto sm:flex",
              "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
              "[-webkit-overflow-scrolling:touch]",
            )}
          >
            {renderNavLinks()}
          </nav>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <PlanBadge />
          {email && (
            <Link
              href="/onboarding?edit=true"
              className="hidden items-center gap-1.5 rounded-full px-2.5 py-1.5 text-sm text-muted-foreground transition hover:bg-secondary hover:text-foreground xl:inline-flex"
              title="编辑个人资料 / 学习者设定"
            >
              <UserCog className="h-3.5 w-3.5" />
              <span className="max-w-[160px] truncate">{email}</span>
            </Link>
          )}
          <Button variant="ghost" size="sm" onClick={handleLogout}>
            <LogOut className="mr-1 h-4 w-4" />
            退出
          </Button>
        </div>
      </div>

      {/* 手机端:横向可滑动的导航条 (桌面 sm+ 走上面那行) */}
      <nav
        aria-label="主导航"
        className={cn(
          "container flex items-center gap-1 overflow-x-auto pb-2 pt-1 sm:hidden",
          // 隐藏滚动条,但保留滚动功能
          "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
          // iOS 惯性滑动
          "[-webkit-overflow-scrolling:touch]",
        )}
      >
        {renderNavLinks(true)}
      </nav>
    </header>
  );
}

/**
 * "对话" tab:点击后跳到最近一条 session;若没有任何 session,
 * 默认创建一个 head_teacher 会话再跳进去 (相当于"开始第一次对话")。
 */
function ChatNavButton({
  active,
  compact = false,
}: {
  active: boolean;
  compact?: boolean;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function go() {
    if (loading) return;
    setLoading(true);
    try {
      const sessions = await chatApi.listSessions();
      const latest = sessions[0]; // 后端已按 updated_at desc 排序
      if (latest) {
        router.push(`/chat/${latest.id}`);
      } else {
        const created = await chatApi.createSession({
          agent_type: "head_teacher",
          subject_id: null,
        });
        router.push(`/chat/${created.id}`);
      }
      // 跳转完成后不清 loading,等下一次 mount 时自动重置 (避免 spinner 闪烁)
    } catch (err) {
      console.error("[ChatNav] 跳转失败", err);
      setLoading(false);
      alert(
        err instanceof Error
          ? `无法打开对话:${err.message}`
          : "无法打开对话,请稍后再试",
      );
    }
  }

  return (
    <button
      type="button"
      onClick={go}
      disabled={loading}
      className={cn(
        "flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-sm transition",
        compact && "px-3 py-1",
        active
          ? "bg-primary/10 text-primary"
          : "text-muted-foreground hover:bg-secondary hover:text-foreground",
        loading && "cursor-wait opacity-70",
      )}
      title="跳到最近的对话"
    >
      {loading ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <MessageSquare className="h-3.5 w-3.5" />
      )}
      对话
    </button>
  );
}

/**
 * Phase 8: 顶栏右上角展示当前套餐 (free/pro).
 * - Free → 链到 /settings/plan (点击后可以看限额 / 联系管理员开通)
 * - Pro  → 展示金色 badge, 不可点或链到 plan 页
 * - 未登录 (billingApi.myPlan 401) → 什么都不渲染
 */
function PlanBadge() {
  const [tier, setTier] = useState<"free" | "pro" | null>(null);

  useEffect(() => {
    let alive = true;
    import("@/lib/api")
      .then(({ billingApi }) => billingApi.myPlan())
      .then((p) => {
        if (alive) setTier(p.is_pro ? "pro" : "free");
      })
      .catch(() => {
        /* 未登录 / 网络失败 → 不显示 */
      });
    return () => {
      alive = false;
    };
  }, []);

  if (!tier) return null;

  if (tier === "pro") {
    return (
      <Link
        href="/settings/plan"
        className="hidden shrink-0 items-center gap-1 rounded-full border border-amber-400/60 bg-gradient-to-br from-amber-100 to-amber-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-amber-800 shadow-sm sm:inline-flex"
        title="Pro 会员 · 查看订阅"
      >
        <Sparkles className="h-3 w-3" />
        Pro
      </Link>
    );
  }
  return (
    <Link
      href="/settings/plan"
      className="hidden shrink-0 items-center gap-1 rounded-full border border-border bg-secondary px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition hover:border-primary/40 hover:text-primary sm:inline-flex"
      title="免费版 · 点击查看限额 / 升级"
    >
      升级 Pro
    </Link>
  );
}
