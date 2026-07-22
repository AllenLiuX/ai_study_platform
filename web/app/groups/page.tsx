"use client";

/**
 * Phase 7: 群组 / 班级 主页
 *
 * 3 个功能区:
 *  1. 我的群 (顶部) — useAgents 式的 cache;点击 → /groups/[id]
 *  2. 搜公开群 (中部) — 输入关键词模糊搜 name/description,点击 → 直接加入
 *  3. 用邀请码加入 (底部) — 私密群唯一途径
 *  4. 右上角 + 创建群
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Search, Sparkles, Users } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { AppHeader } from "@/components/AppHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { groupsApi } from "@/lib/api";
import type { Group } from "@/lib/types";

export default function GroupsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const myGroupsQuery = useQuery({
    queryKey: ["my-groups"],
    queryFn: groupsApi.mine,
    staleTime: 30_000,
  });

  const [searchInput, setSearchInput] = useState("");
  const [searchTerm, setSearchTerm] = useState<string | null>(null);
  const searchQuery = useQuery({
    queryKey: ["groups-search", searchTerm],
    queryFn: () => groupsApi.search(searchTerm ?? ""),
    enabled: searchTerm !== null,
    staleTime: 15_000,
  });

  const [inviteCode, setInviteCode] = useState("");
  const [joinError, setJoinError] = useState<string | null>(null);
  const joinByCode = useMutation({
    mutationFn: (code: string) => groupsApi.joinByCode(code),
    onSuccess: (group) => {
      queryClient.invalidateQueries({ queryKey: ["my-groups"] });
      setInviteCode("");
      setJoinError(null);
      router.push(`/groups/${group.id}`);
    },
    onError: (err) => setJoinError(err instanceof Error ? err.message : "加入失败"),
  });

  const joinPublic = useMutation({
    mutationFn: (id: string) => groupsApi.joinPublic(id),
    onSuccess: (group) => {
      queryClient.invalidateQueries({ queryKey: ["my-groups"] });
      router.push(`/groups/${group.id}`);
    },
  });

  const [creating, setCreating] = useState(false);

  return (
    <div className="min-h-dvh bg-app-gradient">
      <AppHeader />
      <main className="container max-w-4xl space-y-8 py-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">群组 / 班级</h1>
            <p className="text-sm text-muted-foreground">
              建群共享资料库和笔记;适合班级、学习小组、兴趣圈子。
            </p>
          </div>
          <Button onClick={() => setCreating(true)}>
            <Plus className="mr-1.5 h-4 w-4" />
            创建群
          </Button>
        </header>

        {/* ─── 我的群 ─────────────────────────────────── */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            我的群
          </h2>
          {myGroupsQuery.isLoading ? (
            <div className="text-sm text-muted-foreground">加载中…</div>
          ) : myGroupsQuery.data && myGroupsQuery.data.length > 0 ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {myGroupsQuery.data.map((g) => (
                <GroupCard key={g.id} group={g} showMyRole />
              ))}
            </div>
          ) : (
            <Card>
              <CardContent className="p-6 text-center text-sm text-muted-foreground">
                你还没有加入任何群。可以下面搜个公开群 / 输邀请码加入 / 自己建一个。
              </CardContent>
            </Card>
          )}
        </section>

        {/* ─── 搜公开群 ─────────────────────────────── */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            搜索公开群
          </h2>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              setSearchTerm(searchInput.trim());
            }}
          >
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="按名字或描述模糊搜 (例如: 高一三班, 量化面试)"
              maxLength={60}
            />
            <Button type="submit" variant="secondary">
              <Search className="mr-1.5 h-4 w-4" />
              搜索
            </Button>
          </form>
          {searchQuery.isFetching && (
            <div className="text-sm text-muted-foreground">搜索中…</div>
          )}
          {searchQuery.data && searchQuery.data.length === 0 && (
            <p className="text-sm text-muted-foreground">
              没找到匹配的公开群。如果是私密群,让群主给你邀请码。
            </p>
          )}
          {searchQuery.data && searchQuery.data.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-2">
              {searchQuery.data.map((g) => (
                <GroupCard
                  key={g.id}
                  group={g}
                  onJoin={
                    (myGroupsQuery.data ?? []).some((mg) => mg.id === g.id)
                      ? undefined
                      : () => joinPublic.mutate(g.id)
                  }
                  joining={joinPublic.isPending && joinPublic.variables === g.id}
                />
              ))}
            </div>
          )}
        </section>

        {/* ─── 邀请码加群 ────────────────────────────── */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            用邀请码加入
          </h2>
          <Card>
            <CardContent className="p-4">
              <form
                className="flex flex-wrap gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  const c = inviteCode.trim().toUpperCase();
                  if (!c) return;
                  joinByCode.mutate(c);
                }}
              >
                <Input
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                  placeholder="8 位邀请码 (例如: A9K2XZ7Q)"
                  maxLength={16}
                  className="max-w-[240px] font-mono tracking-widest"
                />
                <Button type="submit" disabled={joinByCode.isPending}>
                  {joinByCode.isPending && (
                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                  )}
                  加入
                </Button>
              </form>
              {joinError && (
                <p className="mt-2 text-xs text-destructive">{joinError}</p>
              )}
            </CardContent>
          </Card>
        </section>
      </main>

      {creating && (
        <CreateGroupDialog
          onClose={() => setCreating(false)}
          onCreated={(g) => {
            queryClient.invalidateQueries({ queryKey: ["my-groups"] });
            setCreating(false);
            router.push(`/groups/${g.id}`);
          }}
        />
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
// GroupCard
// -----------------------------------------------------------------------------
function GroupCard({
  group,
  showMyRole,
  onJoin,
  joining,
}: {
  group: Group;
  showMyRole?: boolean;
  onJoin?: () => void;
  joining?: boolean;
}) {
  return (
    <Card className="group transition hover:-translate-y-0.5 hover:shadow-card">
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-foreground/5 text-lg">
              {group.emoji || "👥"}
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <Link
                  href={`/groups/${group.id}`}
                  className="truncate font-semibold hover:text-primary"
                >
                  {group.name}
                </Link>
                {group.is_public ? (
                  <Badge variant="secondary" className="shrink-0">公开</Badge>
                ) : (
                  <Badge variant="outline" className="shrink-0">私密</Badge>
                )}
                {showMyRole && group.my_role === "owner" && (
                  <Badge className="shrink-0 bg-primary/15 text-primary">
                    群主
                  </Badge>
                )}
                {showMyRole && group.my_role === "admin" && (
                  <Badge className="shrink-0">管理</Badge>
                )}
              </div>
              <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                {group.description || "(无简介)"}
              </p>
            </div>
          </div>
        </div>
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Users className="h-3 w-3" /> {group.member_count} 人
          </span>
          {onJoin ? (
            <Button size="sm" variant="ghost" onClick={onJoin} disabled={joining}>
              {joining ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : null}
              加入
            </Button>
          ) : (
            <Link
              href={`/groups/${group.id}`}
              className="text-primary opacity-0 transition group-hover:opacity-100"
            >
              进入 →
            </Link>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// -----------------------------------------------------------------------------
// CreateGroupDialog — 简易模态
// -----------------------------------------------------------------------------
function CreateGroupDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (g: Group) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [emoji, setEmoji] = useState("");
  const [isPublic, setIsPublic] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      groupsApi.create({
        name: name.trim(),
        description: description.trim() || null,
        emoji: emoji.trim() || null,
        is_public: isPublic,
      }),
    onSuccess: onCreated,
    onError: (err) => setError(err instanceof Error ? err.message : "创建失败"),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <button
        type="button"
        onClick={onClose}
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        aria-label="关闭"
      />
      <div className="relative w-full max-w-md rounded-2xl border border-border bg-background p-6 shadow-2xl">
        <h3 className="text-lg font-semibold">创建群组</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          创建后你会拿到一个 8 位邀请码,分享给同学即可加入。
        </p>
        <form
          className="mt-4 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return;
            setError(null);
            mutation.mutate();
          }}
        >
          <div className="grid gap-3 sm:grid-cols-[80px_1fr]">
            <div className="space-y-1.5">
              <Label htmlFor="group-emoji">图标</Label>
              <Input
                id="group-emoji"
                value={emoji}
                onChange={(e) => setEmoji(e.target.value)}
                placeholder="🏫"
                maxLength={4}
                className="text-center text-lg"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="group-name">群名 *</Label>
              <Input
                id="group-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例如: 一中高三 5 班 / 量化 SWE 备考小组"
                maxLength={60}
                required
                autoFocus
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="group-desc">简介 (可选)</Label>
            <Textarea
              id="group-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="这个群做什么、目标是什么"
              maxLength={500}
              rows={3}
              className="resize-none"
            />
          </div>
          <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-border p-3 text-sm">
            <input
              type="checkbox"
              checked={isPublic}
              onChange={(e) => setIsPublic(e.target.checked)}
              className="mt-0.5 h-4 w-4"
            />
            <span>
              <span className="font-medium">公开群</span>
              <span className="ml-1 text-xs text-muted-foreground">
                (勾选后其他人可在「搜索」里找到并直接加入;不勾则只能靠邀请码)
              </span>
            </span>
          </label>
          {error && (
            <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={onClose}>
              取消
            </Button>
            <Button type="submit" disabled={mutation.isPending || !name.trim()}>
              {mutation.isPending ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="mr-1.5 h-4 w-4" />
              )}
              创建
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
