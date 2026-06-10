"use client";

import {
  GraduationCap,
  Library,
  Loader2,
  LogOut,
  MessageSquare,
  Notebook,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { chatApi } from "@/lib/api";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

interface AppHeaderProps {
  className?: string;
}

const NAV_LINKS = [
  { href: "/dashboard", label: "驾驶舱" },
  { href: "/agents", label: "老师", icon: GraduationCap },
  { href: "/materials", label: "资料库", icon: Library },
  { href: "/notes", label: "笔记", icon: Notebook },
] as const;

export function AppHeader({ className }: AppHeaderProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    supabase.auth.getUser().then(({ data }) => {
      setEmail(data.user?.email ?? null);
    });
  }, []);

  async function handleLogout() {
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  return (
    <header
      className={cn(
        "sticky top-0 z-30 border-b border-border/60 bg-background/85 backdrop-blur",
        className,
      )}
    >
      <div className="container flex h-16 items-center justify-between">
        <div className="flex items-center gap-5">
          <Link href="/dashboard" className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-foreground text-background">
              <Sparkles className="h-5 w-5" />
            </span>
            <div className="flex flex-col leading-tight">
              <span className="text-[15px] font-semibold tracking-tight">
                AI 自适应学习平台
              </span>
              <span className="hidden text-[11px] text-muted-foreground sm:inline">
                Your adaptive AI tutor
              </span>
            </div>
          </Link>
          <nav className="hidden items-center gap-1 sm:flex">
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
                    "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm transition",
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
            <ChatNavButton active={pathname?.startsWith("/chat") ?? false} />
          </nav>
        </div>

        <div className="flex items-center gap-3">
          {email && (
            <span className="hidden text-sm text-muted-foreground sm:inline">
              {email}
            </span>
          )}
          <Button variant="ghost" size="sm" onClick={handleLogout}>
            <LogOut className="mr-1 h-4 w-4" />
            退出
          </Button>
        </div>
      </div>
    </header>
  );
}

/**
 * "对话" tab:点击后跳到最近一条 session;若没有任何 session,
 * 默认创建一个 head_teacher 会话再跳进去 (相当于"开始第一次对话")。
 */
function ChatNavButton({ active }: { active: boolean }) {
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
        "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm transition",
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
