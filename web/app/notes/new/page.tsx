"use client";

// Phase 7: useSearchParams 需要 client 侧渲染, 禁用预生成
export const dynamic = "force-dynamic";

import { Suspense } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Loader2, Save, Users } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { groupsApi, notesApi } from "@/lib/api";
import type { KnowledgeNote } from "@/lib/types";

export default function NewNotePage() {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-muted-foreground">加载中…</div>}>
      <NewNotePageInner />
    </Suspense>
  );
}

function NewNotePageInner() {
  const router = useRouter();
  const search = useSearchParams();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [content, setContent] = useState("");
  const [tags, setTags] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Phase 7: 支持 ?group_id=xxx 预设群, 也在表单里给个下拉可改
  const initialGroupId = search?.get("group_id") ?? "";
  const [groupId, setGroupId] = useState<string>(initialGroupId);
  const myGroupsQuery = useQuery({
    queryKey: ["my-groups"],
    queryFn: groupsApi.mine,
    staleTime: 60_000,
  });

  const createMutation = useMutation({
    mutationFn: () =>
      notesApi.create({
        title: title.trim(),
        summary: summary.trim() || undefined,
        content: content.trim(),
        tags: tags
          .split(/[,，\n]/)
          .map((s) => s.trim())
          .filter(Boolean),
        source: "manual",
        group_id: groupId || null,
      }),
    onSuccess: (note: KnowledgeNote) => {
      queryClient.invalidateQueries({ queryKey: ["notes"] });
      router.replace(`/notes/${note.id}`);
    },
    onError: (err) =>
      setError(err instanceof Error ? err.message : "保存失败"),
  });

  const canSubmit =
    !createMutation.isPending &&
    title.trim().length > 0 &&
    content.trim().length > 0;

  return (
    <div className="min-h-screen bg-app-gradient">
      <AppHeader />
      <div className="container max-w-3xl py-8">
        <Link
          href="/notes"
          className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          返回笔记列表
        </Link>
        <h1 className="mb-1 text-2xl font-semibold tracking-tight">
          手动新建笔记
        </h1>
        <p className="mb-6 text-sm text-muted-foreground">
          也可以在对话里点「保存为笔记」,让 AI 自动蒸馏。
        </p>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="title">标题</Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="例如:LRU 缓存淘汰策略"
              maxLength={200}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="summary">摘要 (≤ 40 字,可选)</Label>
            <Input
              id="summary"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="一句话浓缩,便于后续 search 列表展示"
              maxLength={500}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="content">正文 (Markdown,可含 LaTeX)</Label>
            <Textarea
              id="content"
              rows={18}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder={"# LRU 缓存\n\n## 概念\n\n...\n\n## 关键性质\n\n- ...\n\n## 易错点"}
              className="font-mono text-[13px] leading-relaxed"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="tags">标签 (逗号分隔)</Label>
            <Input
              id="tags"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="系统设计, 缓存, 面试"
            />
          </div>
          {/* Phase 7: 归属选择 (个人 / 共享到某个群) */}
          <div className="space-y-2">
            <Label htmlFor="group">
              <Users className="mr-1 inline h-3.5 w-3.5 text-muted-foreground" />
              保存到 (可选)
            </Label>
            <select
              id="group"
              value={groupId}
              onChange={(e) => setGroupId(e.target.value)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="">个人笔记 (仅自己可见)</option>
              {(myGroupsQuery.data ?? []).map((g) => (
                <option key={g.id} value={g.id}>
                  共享到「{g.name}」 · {g.member_count} 人可见
                </option>
              ))}
            </select>
          </div>
          {error && (
            <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button
              onClick={() => createMutation.mutate()}
              disabled={!canSubmit}
              size="lg"
            >
              {createMutation.isPending ? (
                <>
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  保存中…
                </>
              ) : (
                <>
                  <Save className="mr-1 h-4 w-4" />
                  保存笔记
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
