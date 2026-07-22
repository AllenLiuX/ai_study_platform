"use client";

// Phase 7: useSearchParams 需要 client 侧渲染, 禁用预生成
export const dynamic = "force-dynamic";

import { Suspense } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronRight,
  Library,
  Loader2,
  Search,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { AppHeader } from "@/components/AppHeader";
import { MaterialCard } from "@/components/MaterialCard";
import { MaterialUploader } from "@/components/MaterialUploader";
import { ModelBadge } from "@/components/ModelBadge";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { groupsApi, materialsApi, metaApi, studentApi } from "@/lib/api";
import type { Group, Material, Subject } from "@/lib/types";
import { cn } from "@/lib/utils";

type Tab = "mine" | "platform";
type Scope = "personal" | "group" | "all";

const SUBJECT_LABELS: Record<string, string> = {
  math: "数学",
  english: "英语",
  chinese: "语文",
};

export default function MaterialsPage() {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-muted-foreground">加载中…</div>}>
      <MaterialsPageInner />
    </Suspense>
  );
}

function MaterialsPageInner() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const search = useSearchParams();

  // Phase 7: scope 从 URL 读取, 默认 personal
  const urlScope = (search?.get("scope") ?? "personal") as Scope;
  const urlGroupId = search?.get("group_id") ?? null;
  const scope: Scope =
    urlScope === "group" && urlGroupId ? "group" : urlScope === "all" ? "all" : "personal";

  const [tab, setTab] = useState<Tab>("mine");
  const [subjectFilter, setSubjectFilter] = useState<string | null>(null);

  // scope 切换时,回到"我的"tab (平台资料只在 personal 有意义)
  useEffect(() => {
    if (scope !== "personal") setTab("mine");
  }, [scope]);

  const subjectsQuery = useQuery({
    queryKey: ["subjects"],
    queryFn: studentApi.getSubjects,
  });

  const myGroupsQuery = useQuery({
    queryKey: ["my-groups"],
    queryFn: groupsApi.mine,
    staleTime: 60_000,
  });

  const currentGroup = useMemo(
    () =>
      scope === "group" && urlGroupId
        ? (myGroupsQuery.data ?? []).find((g) => g.id === urlGroupId)
        : null,
    [scope, urlGroupId, myGroupsQuery.data],
  );

  const materialsQuery = useQuery({
    queryKey: ["materials", scope, scope === "group" ? urlGroupId : null],
    queryFn: () =>
      scope === "group"
        ? materialsApi.list({ scope: "group", group_id: urlGroupId! })
        : scope === "all"
          ? materialsApi.list({ scope: "all" })
          : materialsApi.list(),
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

  const setScope = (next: Scope, groupId?: string) => {
    const params = new URLSearchParams();
    if (next === "group" && groupId) {
      params.set("scope", "group");
      params.set("group_id", groupId);
    } else if (next === "all") {
      params.set("scope", "all");
    }
    const qs = params.toString();
    router.replace(qs ? `/materials?${qs}` : "/materials");
  };

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
  // scope=group / scope=all 时后端已过滤好, 前端不再区分 mine/platform tab
  const mine = useMemo(
    () =>
      scope === "personal"
        ? all.filter((m) => m.owner_type === "student")
        : all,
    [all, scope],
  );
  const platform = useMemo(
    () =>
      scope === "personal"
        ? all.filter((m) => m.owner_type === "platform")
        : [],
    [all, scope],
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
          <h1 className="text-2xl font-bold tracking-tight">
            {scope === "group" && currentGroup
              ? `${currentGroup.emoji || "👥"} ${currentGroup.name} · 共享资料`
              : "学习资料库"}
          </h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            {scope === "group" && currentGroup ? (
              <>
                这是「{currentGroup.name}」的共享资料库,
                <span className="font-medium text-foreground">群里所有成员</span>都可以看到、下载和引用。
                <Link
                  href={`/groups/${currentGroup.id}`}
                  className="ml-1 text-primary hover:underline"
                >
                  返回群主页 →
                </Link>
              </>
            ) : (
              <>
                平台已经预置了一批 <span className="font-medium text-foreground">基于课程标准生成的 AI 讲义</span>,
                所有学生都可以引用;你也可以上传自己的课本章节、错题本、考试卷,
                这些 <span className="font-medium text-foreground">只有你自己看得到</span>。在和老师对话时勾选若干份,AI 就会基于这些资料回答。
              </>
            )}
          </p>
        </div>

        {/* Phase 7: scope 切换 (我的 / 群组 / 全部) */}
        <ScopeSwitcher
          scope={scope}
          currentGroupId={urlGroupId}
          myGroups={myGroupsQuery.data ?? []}
          onChange={setScope}
        />

        {/* Tab 切换 — 只在 personal scope 下显示 (群组/全部 没有平台 tab) */}
        {scope === "personal" && (
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
        )}

        {tab === "mine" || scope !== "personal" ? (
          <MineTab
            mine={mine}
            mineReady={mineReady}
            mineProcessing={mineProcessing}
            subjects={subjectsQuery.data ?? []}
            embeddingModel={embeddingModel}
            isLoading={materialsQuery.isLoading}
            groupId={scope === "group" ? urlGroupId : null}
            groupName={currentGroup?.name}
            onUploaded={(m) => {
              queryClient.setQueryData<Material[]>(
                ["materials", scope, scope === "group" ? urlGroupId : null],
                (prev) => [m, ...(prev ?? [])],
              );
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
  groupId,
  groupName,
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
  /** Phase 7: 当前在某个群 scope 时, 上传默认归到这个群 */
  groupId?: string | null;
  groupName?: string;
  onUploaded: (m: Material) => void;
  onDelete: (id: string) => void;
  deletingId?: string;
}) {
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
      <MaterialUploader
        subjects={subjects}
        embeddingModel={embeddingModel}
        groupId={groupId ?? undefined}
        groupName={groupName}
        onUploaded={onUploaded}
      />

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-muted-foreground">
            {groupId ? `群「${groupName ?? "…"}」共享资料` : "我上传的"}
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

// -----------------------------------------------------------------------------
// Phase 7: ScopeSwitcher — 个人 / 每个群 / 全部
// -----------------------------------------------------------------------------
function ScopeSwitcher({
  scope,
  currentGroupId,
  myGroups,
  onChange,
}: {
  scope: Scope;
  currentGroupId: string | null;
  myGroups: Group[];
  onChange: (next: Scope, groupId?: string) => void;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
      <ScopeChip
        active={scope === "personal"}
        icon={null}
        label="个人"
        onClick={() => onChange("personal")}
      />
      {myGroups.map((g) => (
        <ScopeChip
          key={g.id}
          active={scope === "group" && currentGroupId === g.id}
          icon={<span>{g.emoji || "👥"}</span>}
          label={g.name}
          hint={`${g.member_count} 人`}
          onClick={() => onChange("group", g.id)}
        />
      ))}
      {myGroups.length > 0 && (
        <ScopeChip
          active={scope === "all"}
          icon={<Users className="h-3 w-3" />}
          label="全部"
          hint="个人 + 所有群"
          onClick={() => onChange("all")}
        />
      )}
      {myGroups.length === 0 && (
        <Link
          href="/groups"
          className="ml-auto inline-flex items-center gap-1 rounded-full border border-dashed border-border px-3 py-1 text-muted-foreground transition hover:border-primary/40 hover:text-primary"
        >
          <Users className="h-3 w-3" />
          去建群 / 加群
        </Link>
      )}
    </div>
  );
}

function ScopeChip({
  active,
  icon,
  label,
  hint,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  hint?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex max-w-[220px] items-center gap-1.5 rounded-full border px-3 py-1 transition",
        active
          ? "border-primary/40 bg-primary/10 text-primary"
          : "border-border bg-card text-muted-foreground hover:border-primary/30 hover:text-foreground",
      )}
    >
      {icon}
      <span className="truncate font-medium">{label}</span>
      {hint && (
        <span className="text-[10px] text-muted-foreground">· {hint}</span>
      )}
    </button>
  );
}
