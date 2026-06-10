"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronRight,
  Library,
  Loader2,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";

import { AppHeader } from "@/components/AppHeader";
import { MaterialCard } from "@/components/MaterialCard";
import { MaterialUploader } from "@/components/MaterialUploader";
import { ModelBadge } from "@/components/ModelBadge";
import { Skeleton } from "@/components/ui/skeleton";
import { materialsApi, metaApi, studentApi } from "@/lib/api";
import type { Material, Subject } from "@/lib/types";
import { cn } from "@/lib/utils";

type Tab = "mine" | "platform";

const SUBJECT_LABELS: Record<string, string> = {
  math: "数学",
  english: "英语",
  chinese: "语文",
};

export default function MaterialsPage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>("mine");
  const [subjectFilter, setSubjectFilter] = useState<string | null>(null);

  const subjectsQuery = useQuery({
    queryKey: ["subjects"],
    queryFn: studentApi.getSubjects,
  });

  const materialsQuery = useQuery({
    queryKey: ["materials"],
    queryFn: materialsApi.list,
    refetchInterval: (q) => {
      const list = (q.state.data as Material[] | undefined) ?? [];
      const stillCooking = list.some(
        (m) =>
          m.owner_type === "student" &&
          (m.parse_status === "pending" || m.parse_status === "processing"),
      );
      return stillCooking ? 2000 : false;
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => materialsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["materials"] });
    },
  });

  const configQuery = useQuery({
    queryKey: ["meta-config"],
    queryFn: metaApi.config,
    staleTime: 5 * 60_000,
  });
  const embeddingModel = configQuery.data?.models.embedding;

  const all = materialsQuery.data ?? [];
  const mine = useMemo(
    () => all.filter((m) => m.owner_type === "student"),
    [all],
  );
  const platform = useMemo(
    () => all.filter((m) => m.owner_type === "platform"),
    [all],
  );

  const mineReady = mine.filter((m) => m.parse_status === "ready").length;
  const mineProcessing = mine.filter(
    (m) => m.parse_status === "pending" || m.parse_status === "processing",
  ).length;

  const platformBySubject = useMemo(() => {
    const map: Record<string, Material[]> = {};
    for (const m of platform) {
      const k = m.subject_id ?? "_other";
      (map[k] ??= []).push(m);
    }
    return map;
  }, [platform]);

  const filteredPlatform = subjectFilter
    ? platform.filter((m) => m.subject_id === subjectFilter)
    : platform;

  return (
    <div className="flex min-h-screen flex-col bg-app-gradient">
      <AppHeader />

      <main className="container flex-1 py-8">
        <div className="mb-6 flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Library className="h-5 w-5" />
              <span className="text-xs font-medium uppercase tracking-wider">
                Knowledge Base
              </span>
            </div>
            {embeddingModel && (
              <ModelBadge model={embeddingModel} label="切片 / 向量化" />
            )}
          </div>
          <h1 className="text-2xl font-bold tracking-tight">学习资料库</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            平台已经预置了一批 <span className="font-medium text-foreground">基于课程标准生成的 AI 讲义</span>,
            所有学生都可以引用;你也可以上传自己的课本章节、错题本、考试卷,
            这些 <span className="font-medium text-foreground">只有你自己看得到</span>。在和老师对话时勾选若干份,AI 就会基于这些资料回答。
          </p>
        </div>

        {/* Tab 切换 */}
        <div className="mb-5 inline-flex items-center gap-1 rounded-full border border-border bg-card p-1 shadow-sm">
          <TabButton
            active={tab === "mine"}
            onClick={() => setTab("mine")}
            label="我的资料"
            count={mine.length}
          />
          <TabButton
            active={tab === "platform"}
            onClick={() => setTab("platform")}
            label="公共资料"
            count={platform.length}
            badge="AI 讲义"
          />
        </div>

        {tab === "mine" ? (
          <MineTab
            mine={mine}
            mineReady={mineReady}
            mineProcessing={mineProcessing}
            subjects={subjectsQuery.data ?? []}
            embeddingModel={embeddingModel}
            isLoading={materialsQuery.isLoading}
            onUploaded={(m) => {
              queryClient.setQueryData<Material[]>(["materials"], (prev) => [
                m,
                ...(prev ?? []),
              ]);
              queryClient.invalidateQueries({ queryKey: ["materials"] });
            }}
            onDelete={(id) => deleteMutation.mutate(id)}
            deletingId={
              deleteMutation.isPending
                ? (deleteMutation.variables as string | undefined)
                : undefined
            }
          />
        ) : (
          <PlatformTab
            platform={filteredPlatform}
            subjectFilter={subjectFilter}
            onSubjectFilterChange={setSubjectFilter}
            bySubject={platformBySubject}
            embeddingModel={embeddingModel}
            isLoading={materialsQuery.isLoading}
          />
        )}
      </main>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  label,
  count,
  badge,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
  badge?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-medium transition",
        active
          ? "bg-foreground text-background"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      <span>{label}</span>
      <span
        className={cn(
          "rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
          active
            ? "bg-background/15 text-background"
            : "bg-secondary text-muted-foreground",
        )}
      >
        {count}
      </span>
      {badge && (
        <span className="inline-flex items-center gap-0.5 rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-primary">
          <Sparkles className="h-2.5 w-2.5" />
          {badge}
        </span>
      )}
    </button>
  );
}

function MineTab({
  mine,
  mineReady,
  mineProcessing,
  subjects,
  embeddingModel,
  isLoading,
  onUploaded,
  onDelete,
  deletingId,
}: {
  mine: Material[];
  mineReady: number;
  mineProcessing: number;
  subjects: Subject[];
  embeddingModel?: string;
  isLoading: boolean;
  onUploaded: (m: Material) => void;
  onDelete: (id: string) => void;
  deletingId?: string;
}) {
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
      <MaterialUploader
        subjects={subjects}
        embeddingModel={embeddingModel}
        onUploaded={onUploaded}
      />

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-muted-foreground">
            我上传的
          </h2>
          {mine.length > 0 && (
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                {mineReady} 份可用
              </span>
              {mineProcessing > 0 && (
                <span className="flex items-center gap-1 text-primary">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  {mineProcessing} 份 AI 处理中
                </span>
              )}
            </div>
          )}
        </div>
        {isLoading ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-32 rounded-2xl" />
            ))}
          </div>
        ) : mine.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-background/40 p-10 text-center">
            <p className="text-sm font-medium">还没有上传过资料</p>
            <p className="mt-1 text-xs text-muted-foreground">
              上传课本扫描 / 错题本 / 试卷,AI 老师就能基于你的内容回答。
            </p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {mine.map((m) => (
              <MaterialCard
                key={m.id}
                material={m}
                embeddingModel={embeddingModel}
                onDelete={() => onDelete(m.id)}
                deleting={deletingId === m.id}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function PlatformTab({
  platform,
  subjectFilter,
  onSubjectFilterChange,
  bySubject,
  embeddingModel,
  isLoading,
}: {
  platform: Material[];
  subjectFilter: string | null;
  onSubjectFilterChange: (s: string | null) => void;
  bySubject: Record<string, Material[]>;
  embeddingModel?: string;
  isLoading: boolean;
}) {
  const SUBJECT_ORDER = ["math", "english", "chinese"];
  const subjectKeys = [
    ...SUBJECT_ORDER.filter((k) => k in bySubject),
    ...Object.keys(bySubject).filter((k) => !SUBJECT_ORDER.includes(k)),
  ];

  const [query, setQuery] = useState("");
  /** 折叠状态:undefined = 跟默认走 (按 subjectFilter 决定),true/false = 用户显式覆盖 */
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const kw = query.trim().toLowerCase();
  const matched = useMemo(
    () =>
      kw
        ? platform.filter((m) => m.title.toLowerCase().includes(kw))
        : platform,
    [platform, kw],
  );
  const matchedBySubject = useMemo(() => {
    const map: Record<string, Material[]> = {};
    for (const m of matched) {
      const k = m.subject_id ?? "_other";
      (map[k] ??= []).push(m);
    }
    return map;
  }, [matched]);

  function isCollapsed(subjectId: string): boolean {
    if (subjectId in collapsed) return collapsed[subjectId];
    if (kw) return false; // 搜索时全部展开
    if (subjectFilter && subjectFilter !== subjectId) return true;
    // 默认行为:有 filter 时只展开 filter 组;无 filter 时全部展开
    return false;
  }

  function toggleCollapsed(subjectId: string) {
    setCollapsed((c) => ({ ...c, [subjectId]: !isCollapsed(subjectId) }));
  }

  const visibleKeys = subjectFilter
    ? subjectKeys.filter((k) => k === subjectFilter)
    : subjectKeys;

  return (
    <div className="space-y-5">
      <div className="surface-ai rounded-2xl border p-4 text-sm">
        <div className="flex items-center gap-2 text-primary">
          <Sparkles className="h-4 w-4" />
          <span className="font-medium">AI 自动生成的通用讲义</span>
        </div>
        <p className="mt-1 text-muted-foreground">
          基于 2022 年义务教育课程标准,由 AI 生成的核心知识点讲义(初中数学 / 英语 / 语文)。
          这些资料对所有学生可见,你可以在对话时随时引用。如果想问自己课本里的具体内容,
          建议切换到「我的资料」上传自己的章节。
        </p>
      </div>

      {/* 学科筛选 + 搜索 */}
      <div className="flex flex-wrap items-center gap-2">
        <FilterChip
          active={subjectFilter === null}
          label="全部"
          count={platform.length}
          onClick={() => onSubjectFilterChange(null)}
        />
        {subjectKeys.map((s) => (
          <FilterChip
            key={s}
            active={subjectFilter === s}
            label={SUBJECT_LABELS[s] ?? s}
            count={bySubject[s]?.length ?? 0}
            onClick={() => onSubjectFilterChange(s)}
          />
        ))}
        <div className="ml-auto flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1">
          <Search className="h-3.5 w-3.5 text-muted-foreground" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索讲义标题…"
            className="w-44 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="rounded-full p-0.5 text-muted-foreground hover:bg-secondary"
              aria-label="清空"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-32 rounded-2xl" />
          ))}
        </div>
      ) : platform.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-background/40 p-10 text-center">
          <p className="text-sm font-medium">公共资料库还没有内容</p>
          <p className="mt-1 text-xs text-muted-foreground">
            管理员可以用 <code>scripts/seed_platform_materials.py</code> 批量入库。
          </p>
        </div>
      ) : matched.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-background/40 p-10 text-center text-sm text-muted-foreground">
          没有匹配 “{query}” 的讲义
        </div>
      ) : (
        <div className="space-y-3">
          {visibleKeys.map((s) => {
            const items = matchedBySubject[s] ?? [];
            if (items.length === 0) return null;
            const open = !isCollapsed(s);
            return (
              <section
                key={s}
                className="overflow-hidden rounded-2xl border border-border bg-card"
              >
                <button
                  type="button"
                  onClick={() => toggleCollapsed(s)}
                  className="flex w-full items-center gap-2 px-4 py-2.5 text-left hover:bg-secondary/60"
                >
                  {open ? (
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  )}
                  <Sparkles className="h-3.5 w-3.5 text-primary" />
                  <span className="text-sm font-semibold">
                    {SUBJECT_LABELS[s] ?? s}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    · {items.length} 份讲义
                  </span>
                </button>
                {open && (
                  <div className="grid gap-3 border-t border-border/60 bg-background/40 p-3 sm:grid-cols-2 lg:grid-cols-3">
                    {items.map((m) => (
                      <MaterialCard
                        key={m.id}
                        material={m}
                        embeddingModel={embeddingModel}
                        readOnly
                      />
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function FilterChip({
  active,
  label,
  count,
  onClick,
}: {
  active: boolean;
  label: string;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition",
        active
          ? "border-primary/30 bg-primary/10 text-primary"
          : "border-border bg-card text-muted-foreground hover:border-primary/30 hover:text-foreground",
      )}
    >
      {label}
      <span
        className={cn(
          "rounded-full px-1.5 text-[10px] font-semibold",
          active ? "bg-primary/15 text-primary" : "bg-secondary text-muted-foreground",
        )}
      >
        {count}
      </span>
    </button>
  );
}
