"use client";

/**
 * Phase 7: 群详情页
 *
 * 展示:
 *  - 群头 (emoji + name + 简介 + 公开/私密 + 邀请码 + 成员数)
 *  - 我的角色 (owner/admin/member) + 相应操作 (退群 / 删群)
 *  - 成员列表 (前 20 个;owner/admin 可踢人)
 *  - 共享资料 (前 8 条;点"查看全部"跳 /materials?scope=group&group_id=...)
 *  - 共享笔记 (前 8 条;同上)
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  Copy,
  FileText,
  Loader2,
  LogOut,
  Notebook,
  Pencil,
  Save,
  Trash2,
  UserMinus,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { AppHeader } from "@/components/AppHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { groupsApi, materialsApi, notesApi } from "@/lib/api";
import type { GroupDetail, GroupMember } from "@/lib/types";

export default function GroupDetailPage() {
  const params = useParams<{ id: string }>();
  const groupId = params?.id ?? "";
  const router = useRouter();
  const queryClient = useQueryClient();

  const detailQuery = useQuery({
    queryKey: ["group-detail", groupId],
    queryFn: () => groupsApi.get(groupId),
    enabled: !!groupId,
  });

  const materialsQuery = useQuery({
    queryKey: ["group-materials", groupId],
    queryFn: () => materialsApi.list({ scope: "group", group_id: groupId }),
    enabled: !!groupId,
    staleTime: 30_000,
  });

  const notesQuery = useQuery({
    queryKey: ["group-notes", groupId],
    queryFn: () => notesApi.list({ scope: "group", group_id: groupId }),
    enabled: !!groupId,
    staleTime: 30_000,
  });

  const membersQuery = useQuery({
    queryKey: ["group-members", groupId],
    queryFn: () => groupsApi.members(groupId),
    enabled: !!groupId,
  });

  const leave = useMutation({
    mutationFn: () => groupsApi.leave(groupId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["my-groups"] });
      router.push("/groups");
    },
  });

  const remove = useMutation({
    mutationFn: () => groupsApi.remove(groupId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["my-groups"] });
      router.push("/groups");
    },
  });

  const kick = useMutation({
    mutationFn: (userId: string) => groupsApi.kick(groupId, userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["group-detail", groupId] });
      queryClient.invalidateQueries({ queryKey: ["group-members", groupId] });
    },
  });

  const [copyState, setCopyState] = useState<"idle" | "copied">("idle");
  const [editing, setEditing] = useState(false);
  const copyInvite = () => {
    if (!detailQuery.data?.invite_code) return;
    navigator.clipboard.writeText(detailQuery.data.invite_code).then(() => {
      setCopyState("copied");
      setTimeout(() => setCopyState("idle"), 2000);
    });
  };

  const detail = detailQuery.data;
  const isOwner = detail?.my_role === "owner";
  const isAdmin = detail?.my_role === "admin" || isOwner;

  const sortedMembers = useMemo(() => {
    const rows = membersQuery.data ?? detail?.members_preview ?? [];
    const order: Record<string, number> = { owner: 0, admin: 1, member: 2 };
    return [...rows].sort(
      (a, b) => (order[a.role] ?? 9) - (order[b.role] ?? 9),
    );
  }, [membersQuery.data, detail?.members_preview]);

  if (detailQuery.isLoading) {
    return (
      <div className="min-h-dvh bg-app-gradient">
        <AppHeader />
        <main className="container max-w-4xl py-6 text-sm text-muted-foreground">
          加载中…
        </main>
      </div>
    );
  }

  if (detailQuery.error || !detail) {
    return (
      <div className="min-h-dvh bg-app-gradient">
        <AppHeader />
        <main className="container max-w-4xl space-y-4 py-6">
          <p className="text-sm text-destructive">
            {detailQuery.error instanceof Error
              ? detailQuery.error.message
              : "群不存在或你不是成员"}
          </p>
          <Link href="/groups" className="text-sm text-primary hover:underline">
            ← 返回群列表
          </Link>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-app-gradient">
      <AppHeader />
      <main className="container max-w-4xl space-y-6 py-6">
        <Link
          href="/groups"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary"
        >
          ← 所有群
        </Link>

        {/* ─── 群头 ────────────────────────────────── */}
        <section className="flex flex-col gap-4 sm:flex-row sm:items-start">
          <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-foreground/5 text-3xl">
            {detail.emoji || "👥"}
          </span>
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">
                {detail.name}
              </h1>
              {detail.is_public ? (
                <Badge variant="secondary">公开</Badge>
              ) : (
                <Badge variant="outline">私密</Badge>
              )}
              {isOwner && (
                <Badge className="bg-primary/15 text-primary">群主</Badge>
              )}
              {detail.my_role === "admin" && <Badge>管理</Badge>}
            </div>
            {detail.description && (
              <p className="text-sm text-muted-foreground">{detail.description}</p>
            )}
            <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <Users className="h-3.5 w-3.5" /> {detail.member_count} 人
              </span>
              <button
                type="button"
                onClick={copyInvite}
                className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 font-mono text-xs tracking-widest hover:border-primary/40 hover:text-primary"
                title="点击复制邀请码"
              >
                <Copy className="h-3 w-3" />
                {detail.invite_code}
                {copyState === "copied" && (
                  <span className="ml-1 font-sans text-[10px] text-primary">
                    已复制
                  </span>
                )}
              </button>
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            {isOwner && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setEditing(true)}
              >
                <Pencil className="mr-1.5 h-4 w-4" />
                编辑信息
              </Button>
            )}
            {isOwner ? (
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:bg-destructive/10"
                onClick={() => {
                  if (
                    confirm(
                      `解散群「${detail.name}」? 群内所有资料和笔记也会一起删除,无法恢复。`,
                    )
                  ) {
                    remove.mutate();
                  }
                }}
                disabled={remove.isPending}
              >
                <Trash2 className="mr-1.5 h-4 w-4" />
                解散群
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  if (confirm(`确定退出群「${detail.name}」?`)) leave.mutate();
                }}
                disabled={leave.isPending}
              >
                <LogOut className="mr-1.5 h-4 w-4" />
                退群
              </Button>
            )}
          </div>
        </section>

        {/* ─── 共享资料 ─────────────────────────────── */}
        <SharedSection
          title="共享资料"
          icon={<FileText className="h-4 w-4" />}
          count={detail.materials_count}
          seeAllHref={`/materials?scope=group&group_id=${groupId}`}
          empty={
            <>
              还没有共享资料。到{" "}
              <Link
                href={`/materials?scope=group&group_id=${groupId}`}
                className="text-primary hover:underline"
              >
                资料库
              </Link>{" "}
              把 PDF / DOCX / 图片上传进来,群里所有人都能看到。
            </>
          }
        >
          {(materialsQuery.data ?? []).slice(0, 8).map((m) => (
            <li key={m.id}>
              <Link
                href={`/materials`}
                className="flex items-center justify-between gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm transition hover:border-primary/40 hover:bg-primary/5"
              >
                <span className="truncate">
                  <FileText className="mr-1.5 inline h-3.5 w-3.5 text-muted-foreground" />
                  {m.title}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {(m.size_bytes / 1024 / 1024).toFixed(1)} MB
                </span>
              </Link>
            </li>
          ))}
        </SharedSection>

        {/* ─── 共享笔记 ─────────────────────────────── */}
        <SharedSection
          title="共享笔记"
          icon={<Notebook className="h-4 w-4" />}
          count={detail.notes_count}
          seeAllHref={`/notes?scope=group&group_id=${groupId}`}
          empty={
            <>
              还没有共享笔记。写笔记或听课蒸馏时选到这个群就能共享。
            </>
          }
        >
          {(notesQuery.data ?? []).slice(0, 8).map((n) => (
            <li key={n.id}>
              <Link
                href={`/notes/${n.id}`}
                className="flex items-center justify-between gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm transition hover:border-primary/40 hover:bg-primary/5"
              >
                <span className="truncate">
                  <Notebook className="mr-1.5 inline h-3.5 w-3.5 text-muted-foreground" />
                  {n.title}
                </span>
                {n.tags.length > 0 && (
                  <span className="shrink-0 text-xs text-muted-foreground">
                    #{n.tags[0]}
                  </span>
                )}
              </Link>
            </li>
          ))}
        </SharedSection>

        {/* ─── 成员 ─────────────────────────────────── */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              成员 ({detail.member_count})
            </h2>
          </div>
          <Card>
            <CardContent className="p-3">
              <ul className="divide-y divide-border">
                {sortedMembers.map((m) => (
                  <MemberRow
                    key={m.user_id}
                    member={m}
                    canKick={isAdmin && m.role !== "owner"}
                    onKick={() =>
                      confirm(`把该成员踢出群?`) && kick.mutate(m.user_id)
                    }
                    kicking={kick.isPending && kick.variables === m.user_id}
                  />
                ))}
              </ul>
            </CardContent>
          </Card>
        </section>
      </main>

      {editing && (
        <EditGroupDialog
          group={detail}
          onClose={() => setEditing(false)}
          onSaved={() => {
            queryClient.invalidateQueries({ queryKey: ["group-detail", groupId] });
            queryClient.invalidateQueries({ queryKey: ["my-groups"] });
            setEditing(false);
          }}
        />
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
// EditGroupDialog — 群主专用
// -----------------------------------------------------------------------------
function EditGroupDialog({
  group,
  onClose,
  onSaved,
}: {
  group: GroupDetail;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(group.name);
  const [description, setDescription] = useState(group.description ?? "");
  const [emoji, setEmoji] = useState(group.emoji ?? "");
  const [isPublic, setIsPublic] = useState(!!group.is_public);
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      groupsApi.update(group.id, {
        name: name.trim(),
        description: description.trim() || null,
        emoji: emoji.trim() || null,
        is_public: isPublic,
      }),
    onSuccess: onSaved,
    onError: (err) => setError(err instanceof Error ? err.message : "保存失败"),
  });

  // ESC 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const changed =
    name.trim() !== group.name ||
    (description.trim() || null) !== (group.description ?? null) ||
    (emoji.trim() || null) !== (group.emoji ?? null) ||
    isPublic !== !!group.is_public;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="关闭"
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
      />
      <div className="relative w-full max-w-md rounded-2xl border border-border bg-background p-6 shadow-2xl">
        <h3 className="text-lg font-semibold">编辑群信息</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          邀请码 <span className="font-mono">{group.invite_code}</span> 不会变。
        </p>
        <form
          className="mt-4 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim() || !changed) return;
            setError(null);
            mutation.mutate();
          }}
        >
          <div className="grid gap-3 sm:grid-cols-[80px_1fr]">
            <div className="space-y-1.5">
              <Label htmlFor="edit-emoji">图标</Label>
              <Input
                id="edit-emoji"
                value={emoji}
                onChange={(e) => setEmoji(e.target.value)}
                placeholder="🏫"
                maxLength={4}
                className="text-center text-lg"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-name">群名 *</Label>
              <Input
                id="edit-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={60}
                required
                autoFocus
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-desc">简介</Label>
            <Textarea
              id="edit-desc"
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
                (勾选后其他人可在「搜索」里找到并直接加入)
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
            <Button
              type="submit"
              disabled={mutation.isPending || !name.trim() || !changed}
            >
              {mutation.isPending ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-1.5 h-4 w-4" />
              )}
              保存
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function SharedSection({
  title,
  icon,
  count,
  seeAllHref,
  empty,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  count: number;
  seeAllHref: string;
  empty: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          {icon}
          {title} ({count})
        </h2>
        {count > 0 && (
          <Link
            href={seeAllHref}
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            查看全部 <ArrowRight className="h-3 w-3" />
          </Link>
        )}
      </div>
      {count === 0 ? (
        <Card>
          <CardContent className="p-4 text-sm text-muted-foreground">
            {empty}
          </CardContent>
        </Card>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">{children}</ul>
      )}
    </section>
  );
}

function MemberRow({
  member,
  canKick,
  onKick,
  kicking,
}: {
  member: GroupMember;
  canKick: boolean;
  onKick: () => void;
  kicking: boolean;
}) {
  const initial = (member.display_name || member.user_id).slice(0, 1).toUpperCase();
  const roleTag = member.role === "owner" ? "群主" : member.role === "admin" ? "管理" : "";
  return (
    <li className="flex items-center gap-3 py-2">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
        {initial}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium">
            {member.display_name || member.email || `${member.user_id.slice(0, 8)}…`}
          </span>
          {roleTag && (
            <Badge
              variant={member.role === "owner" ? "default" : "secondary"}
              className="shrink-0"
            >
              {roleTag}
            </Badge>
          )}
        </div>
        {member.joined_at && (
          <div className="text-[10px] text-muted-foreground">
            {new Date(member.joined_at).toLocaleDateString("zh-CN")} 加入
          </div>
        )}
      </div>
      {canKick && (
        <button
          type="button"
          onClick={onKick}
          disabled={kicking}
          className="shrink-0 rounded-md p-1.5 text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
          title="踢出群"
        >
          {kicking ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <UserMinus className="h-3.5 w-3.5" />
          )}
        </button>
      )}
    </li>
  );
}
