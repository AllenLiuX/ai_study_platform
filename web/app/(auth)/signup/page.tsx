"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export default function SignupPage() {
  const router = useRouter();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needEmailConfirm, setNeedEmailConfirm] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { name },
          emailRedirectTo:
            typeof window !== "undefined"
              ? `${window.location.origin}/onboarding`
              : undefined,
        },
      });
      if (error) throw error;
      if (data.session) {
        router.replace("/onboarding");
        router.refresh();
      } else {
        // Supabase 项目要求邮箱确认
        setNeedEmailConfirm(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "注册失败,请重试");
    } finally {
      setLoading(false);
    }
  }

  if (needEmailConfirm) {
    return (
      <Card>
        <CardHeader className="text-center">
          <CardTitle>📩 请去邮箱确认一下</CardTitle>
          <CardDescription>
            我们给 <strong>{email}</strong> 发了一封验证邮件,点击其中的链接就能登录了。
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          <p>
            没收到?可以稍等几分钟,或检查垃圾邮件文件夹。也可以联系平台管理员在 Supabase
            后台手动确认。
          </p>
          <Link
            href="/login"
            className="mt-6 inline-block font-medium text-primary hover:underline"
          >
            返回登录页 →
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="space-y-2 text-center">
        <CardTitle className="text-2xl">注册新账号</CardTitle>
        <CardDescription>
          只需邮箱和密码,几秒就能开始体验
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">昵称</Label>
            <Input
              id="name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如:小明"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">邮箱</Label>
            <Input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">密码</Label>
            <Input
              id="password"
              type="password"
              required
              minLength={6}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="至少 6 位,建议字母+数字"
            />
          </div>
          {error && (
            <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}
          <Button type="submit" size="lg" className="w-full" disabled={loading}>
            {loading ? "创建中…" : "创建账号"}
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          已经有账号?{" "}
          <Link
            href="/login"
            className="font-medium text-primary hover:underline"
          >
            直接登录
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
