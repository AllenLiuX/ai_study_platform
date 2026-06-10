"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  CheckCircle2,
  Edit3,
  Loader2,
  Save,
  Trash2,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { AppHeader } from "@/components/AppHeader";
import { MarkdownMessage } from "@/components/MarkdownMessage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { resolveAgentMeta } from "@/lib/agents";
import { notesApi } from "@/lib/api";
import { useAgents } from "@/lib/hooks/useAgents";
import type { KnowledgeNote } from "@/lib/types";
import { cn } from "@/lib/utils";

export default function NoteDetailPage() {
  const params = useParams();
  const noteId = String(params?.noteId ?? "");
  const router = useRouter();
  const queryClient = useQueryClient();
  const agentsQuery = useAgents();

  const noteQuery = useQuery<KnowledgeNote>({
    queryKey: ["note", noteId],
    queryFn: () => notesApi.get(noteId),
    enabled: !!noteId,
    refetchInterval: (q) => {
      const n = q.state.data as KnowledgeNote | undefined;
      if (!n) return false;
      return n.chunk_status === "pending" || n.chunk_status === "processing"
        ? 3000
        : false;
    },
  });

  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [content, setContent] = useState("");
  const [tags, setTags] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!noteQuery.data) return;
    setTitle(noteQuery.data.title);
    setSummary(noteQuery.data.summary ?? "");
    setContent(noteQuery.data.content);
    setTags(noteQuery.data.tags.join(", "));
  }, [noteQuery.data]);

  const updateMutation = useMutation({
    mutationFn: () =>
      notesApi.update(noteId, {
        title: title.trim(),
        summary: summary.trim() || null,
        content: content.trim(),
        tags: tags
          .split(/[,，\n]/)
          .map((s) => s.trim())
          .filter(Boolean),
      }),
    onSuccess: (note) => {
      queryClient.setQueryData(["note", noteId], note);
      queryClient.invalidateQueries({ queryKey: ["notes"] });
      setEditing(false);
      setError(null);
    },
    onError: (err) =>
      setError(err instanceof Error ? err.message : "保存失败"),
  });

  const reviewMutation = useMutation({
    mutationFn: (score: number) => notesApi.review(noteId, score),
    onSuccess: (note) => {
      queryClient.setQueryData(["note", noteId], note);
      queryClient.invalidateQueries({ queryKey: ["notes"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => notesApi.delete(noteId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notes"] });
      router.replace("/notes");
    },
    onError: (err) =>
      setError(err instanceof Error ? err.message : "删除失败"),
  });

  if (noteQuery.isLoading) {
    return (
      <div className="min-h-screen bg-app-gradient">
        <AppHeader />
        <div className="container max-w-3xl py-8">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            加载中…
          </div>
        </div>
      </div>
    );
  }

  if (noteQuery.error || !noteQuery.data) {
    return (
      <div className="min-h-screen bg-app-gradient">
        <AppHeader />
        <div className="container max-w-3xl py-8">
          <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {(noteQuery.error as Error)?.message || "笔记不存在"}
          </p>
        </div>
      </div>
    );
  }

  const note = noteQuery.data;
  const agent = note.agent_key
    ? resolveAgentMeta(note.agent_key, agentsQuery.data)
    : null;

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

        {/* 元信息条 */}
        <div className="mb-4 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {agent && (
            <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5">
              <span>{agent.emoji}</span>
              {agent.displayName}
            </span>
          )}
          <ChunkBadge note={note} />
          <span>掌握度 {note.mastery_score}% · 复习 {note.review_count} 次</span>
          {note.origin_session_id && (
            <Link
              href={`/chat/${note.origin_session_id}`}
              className="rounded-full border border-border px-2 py-0.5 hover:border-primary/40 hover:text-foreground"
            >
              返回原对话 →
            </Link>
          )}
        </div>

        {editing ? (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="title">标题</Label>
              <Input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={200}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="summary">摘要 (≤ 40 字)</Label>
              <Input
                id="summary"
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                maxLength={500}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="content">正文 (Markdown)</Label>
              <Textarea
                id="content"
                rows={20}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                className="font-mono text-[13px] leading-relaxed"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tags">标签 (逗号分隔)</Label>
              <Input
                id="tags"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
              />
            </div>
            {error && (
              <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setEditing(false)}>
                取消
              </Button>
              <Button
                onClick={() => updateMutation.mutate()}
                disabled={updateMutation.isPending}
              >
                {updateMutation.isPending ? (
                  <>
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                    保存中…
                  </>
                ) : (
                  <>
                    <Save className="mr-1 h-4 w-4" />
                    保存修改
                  </>
                )}
              </Button>
            </div>
          </div>
        ) : (
          <>
            <h1 className="mb-1 text-3xl font-semibold tracking-tight">
              {note.title}
            </h1>
            {note.summary && (
              <p className="mb-4 text-sm text-muted-foreground">
                {note.summary}
              </p>
            )}
            {note.tags.length > 0 && (
              <div className="mb-6 flex flex-wrap gap-1.5">
                {note.tags.map((t) => (
                  <span
                    key={t}
                    className="rounded-full bg-secondary px-2 py-0.5 text-[11px] text-muted-foreground"
                  >
                    {t}
                  </span>
                ))}
              </div>
            )}

            <article className="rounded-2xl border border-border bg-card p-6 shadow-card">
              <MarkdownMessage content={note.content} variant="assistant" />
            </article>

            <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <ReviewQuickBar
                  current={note.mastery_score}
                  onPick={(score) => reviewMutation.mutate(score)}
                  pending={reviewMutation.isPending}
                />
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  onClick={() => setEditing(true)}
                  size="sm"
                >
                  <Edit3 className="mr-1 h-3.5 w-3.5" />
                  编辑
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    if (
                      !window.confirm(
                        "确定删除这条笔记?切片向量也会一起清掉,RAG 将不再召回它。",
                      )
                    )
                      return;
                    deleteMutation.mutate();
                  }}
                  className="border-destructive/30 text-destructive hover:bg-destructive/5"
                >
                  <Trash2 className="mr-1 h-3.5 w-3.5" />
                  删除
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ChunkBadge({ note }: { note: KnowledgeNote }) {
  if (note.chunk_status === "ready") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/5 px-2 py-0.5 text-emerald-600 dark:text-emerald-400">
        <CheckCircle2 className="h-3 w-3" />
        参与 RAG · {note.chunk_count} 段
      </span>
    );
  }
  if (note.chunk_status === "failed") {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full border border-destructive/30 bg-destructive/5 px-2 py-0.5 text-destructive"
        title={note.chunk_error || ""}
      >
        <XCircle className="h-3 w-3" />
        切片失败
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5">
      <Loader2 className="h-3 w-3 animate-spin" />
      切片中
    </span>
  );
}

function ReviewQuickBar({
  current,
  onPick,
  pending,
}: {
  current: number;
  onPick: (score: number) => void;
  pending: boolean;
}) {
  const buckets: { label: string; score: number; hint: string }[] = [
    { label: "完全没掌握", score: 10, hint: "10" },
    { label: "有点印象", score: 40, hint: "40" },
    { label: "基本掌握", score: 70, hint: "70" },
    { label: "熟练掌握", score: 95, hint: "95" },
  ];
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-muted-foreground">
        刚复习完?评估一下:
      </span>
      {buckets.map((b) => (
        <button
          key={b.score}
          type="button"
          onClick={() => onPick(b.score)}
          disabled={pending}
          className={cn(
            "rounded-full border px-2.5 py-1 text-[11px] transition",
            current >= b.score - 5 && current <= b.score + 5
              ? "border-primary bg-primary/10 text-primary"
              : "border-border hover:border-primary/40",
            pending && "opacity-50",
          )}
          title={`掌握度调到约 ${b.hint}`}
        >
          {b.label}
        </button>
      ))}
    </div>
  );
}
