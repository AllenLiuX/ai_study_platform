"use client";

import {
  Check,
  ChevronDown,
  ChevronRight,
  FileText,
  Library,
  Loader2,
  Paperclip,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import type { Material } from "@/lib/types";
import { cn } from "@/lib/utils";

interface MaterialPickerProps {
  materials: Material[];
  isLoading?: boolean;
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}

const SUBJECT_LABELS: Record<string, string> = {
  math: "数学",
  english: "英语",
  chinese: "语文",
};

const SUBJECT_ORDER = ["math", "english", "chinese"];

type Group = {
  /** group 唯一 id,用于折叠状态 */
  id: string;
  /** 顶部展示的中文标题 */
  label: string;
  /** 是否平台资料 (影响 icon) */
  isPlatform: boolean;
  items: Material[];
};

export function MaterialPicker({
  materials,
  isLoading,
  selectedIds,
  onChange,
}: MaterialPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const ready = useMemo(
    () => materials.filter((m) => m.parse_status === "ready"),
    [materials],
  );

  /** 按 "我的 + 学科" 分组,先过滤搜索词,group 顺序固定 */
  const groups = useMemo<Group[]>(() => {
    const kw = query.trim().toLowerCase();
    const matched = kw
      ? ready.filter((m) => m.title.toLowerCase().includes(kw))
      : ready;

    const mine: Material[] = [];
    const bySubject = new Map<string, Material[]>();
    for (const m of matched) {
      if (m.owner_type === "student") {
        mine.push(m);
      } else {
        const k = m.subject_id ?? "_other";
        const list = bySubject.get(k) ?? [];
        list.push(m);
        bySubject.set(k, list);
      }
    }

    const out: Group[] = [];
    if (mine.length > 0) {
      out.push({
        id: "mine",
        label: "我上传的",
        isPlatform: false,
        items: mine,
      });
    }
    const subjectKeys = [
      ...SUBJECT_ORDER.filter((k) => bySubject.has(k)),
      ...[...bySubject.keys()].filter((k) => !SUBJECT_ORDER.includes(k)),
    ];
    for (const k of subjectKeys) {
      out.push({
        id: `subject:${k}`,
        label: `${SUBJECT_LABELS[k] ?? k} · AI 公共讲义`,
        isPlatform: true,
        items: bySubject.get(k) ?? [],
      });
    }
    return out;
  }, [ready, query]);

  /** 默认折叠规则:
   * - "我的" 永远默认展开
   * - 其它学科只在有搜索关键字时展开 (确保用户能立刻看到匹配)
   * - 否则默认折叠 (避免 50+ 一齐铺开)
   */
  function isCollapsed(groupId: string): boolean {
    if (groupId in collapsed) return collapsed[groupId];
    if (query.trim()) return false; // 搜索时全部展开
    return groupId !== "mine";
  }

  function toggleCollapsed(groupId: string) {
    setCollapsed((c) => ({ ...c, [groupId]: !isCollapsed(groupId) }));
  }

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  function toggleOne(id: string) {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(Array.from(next));
  }

  /** 整组切换:全选(若组内任一未选) / 全取消(若已全选) */
  function toggleGroup(group: Group) {
    const allSelected = group.items.every((m) => selectedSet.has(m.id));
    const next = new Set(selectedIds);
    if (allSelected) {
      for (const m of group.items) next.delete(m.id);
    } else {
      for (const m of group.items) next.add(m.id);
    }
    onChange(Array.from(next));
  }

  function clearAll() {
    onChange([]);
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        正在加载资料库…
      </div>
    );
  }

  if (ready.length === 0) {
    return (
      <Link
        href="/materials"
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition hover:text-primary"
      >
        <Paperclip className="h-3 w-3" />
        想让老师基于资料回答? 去
        <span className="underline underline-offset-2">资料库</span>
        上传或选公共讲义
      </Link>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs transition",
            selectedIds.length > 0
              ? "bg-primary/10 text-primary"
              : "bg-secondary text-secondary-foreground hover:bg-secondary/80",
          )}
        >
          <Paperclip className="h-3 w-3" />
          引用资料
          {selectedIds.length > 0 ? (
            <span className="ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] text-primary-foreground">
              {selectedIds.length}
            </span>
          ) : null}
        </button>

        {selectedIds.length > 0 &&
          ready
            .filter((m) => selectedSet.has(m.id))
            .slice(0, 3)
            .map((m) => (
              <span
                key={m.id}
                className="inline-flex max-w-[220px] items-center gap-1 truncate rounded-full bg-primary/5 px-2.5 py-1 text-[11px] text-primary"
              >
                {m.owner_type === "platform" ? (
                  <Sparkles className="h-3 w-3 shrink-0" />
                ) : (
                  <FileText className="h-3 w-3 shrink-0" />
                )}
                <span className="truncate">{m.title}</span>
                <button
                  type="button"
                  className="ml-0.5 -mr-0.5 rounded-full p-0.5 hover:bg-primary/10"
                  onClick={() => toggleOne(m.id)}
                  aria-label="取消引用"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
        {selectedIds.length > 3 && (
          <span className="text-[11px] text-muted-foreground">
            …还有 {selectedIds.length - 3} 份
          </span>
        )}
        {selectedIds.length > 0 && (
          <button
            type="button"
            onClick={clearAll}
            className="ml-1 text-[11px] text-muted-foreground hover:text-destructive"
          >
            清空
          </button>
        )}
      </div>

      {open && (
        <div className="max-h-96 overflow-hidden rounded-xl border border-border bg-card shadow-card">
          {/* 头部:标题 + 搜索框 + 收起 */}
          <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2">
            <Library className="h-3.5 w-3.5 shrink-0 text-primary" />
            <span className="text-xs text-primary">选择资料让老师基于内容回答</span>
            <div className="flex flex-1 items-center gap-1.5 rounded-full bg-secondary px-2 py-1">
              <Search className="h-3 w-3 text-muted-foreground" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索讲义标题…"
                className="w-full bg-transparent text-[11px] outline-none placeholder:text-muted-foreground"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  className="rounded-full p-0.5 text-muted-foreground hover:bg-background"
                  aria-label="清空搜索"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={() => setOpen(false)}
            >
              收起
            </Button>
          </div>

          <div className="max-h-80 overflow-y-auto p-1.5 scrollbar-thin">
            {groups.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                没有匹配 “{query}” 的资料
              </div>
            ) : (
              groups.map((g) => (
                <PickerGroup
                  key={g.id}
                  group={g}
                  collapsed={isCollapsed(g.id)}
                  selectedSet={selectedSet}
                  onToggleCollapsed={() => toggleCollapsed(g.id)}
                  onToggleOne={toggleOne}
                  onToggleGroup={() => toggleGroup(g)}
                />
              ))
            )}
          </div>

          <div className="flex items-center justify-between border-t border-border/60 px-3 py-2 text-[11px]">
            <span className="text-muted-foreground">
              共 {ready.length} 份 · 已选 {selectedIds.length} 份
            </span>
            <Link href="/materials" className="text-primary hover:underline">
              管理资料库 →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

function PickerGroup({
  group,
  collapsed,
  selectedSet,
  onToggleCollapsed,
  onToggleOne,
  onToggleGroup,
}: {
  group: Group;
  collapsed: boolean;
  selectedSet: Set<string>;
  onToggleCollapsed: () => void;
  onToggleOne: (id: string) => void;
  onToggleGroup: () => void;
}) {
  const selectedInGroup = group.items.filter((m) => selectedSet.has(m.id)).length;
  const allSelected = selectedInGroup === group.items.length && group.items.length > 0;
  const someSelected = selectedInGroup > 0 && !allSelected;

  return (
    <div className="mb-1 rounded-lg border border-transparent hover:border-border/60">
      <div
        role="button"
        tabIndex={0}
        onClick={onToggleCollapsed}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggleCollapsed();
          }
        }}
        className="flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs hover:bg-secondary"
      >
        {collapsed ? (
          <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
        )}
        {group.isPlatform && (
          <Sparkles className="h-3 w-3 shrink-0 text-primary" />
        )}
        <span className="font-medium">{group.label}</span>
        <span className="text-[10px] text-muted-foreground">
          · {group.items.length}
        </span>
        {selectedInGroup > 0 && (
          <span className="ml-1 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">
            已选 {selectedInGroup}
          </span>
        )}
        <div className="ml-auto">
          {/* 整组全选 / 取消 — 单独 button,阻止冒泡免得触发折叠 */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleGroup();
            }}
            className={cn(
              "rounded-md px-2 py-0.5 text-[10px] font-medium transition",
              allSelected
                ? "bg-primary/10 text-primary hover:bg-primary/15"
                : someSelected
                  ? "bg-primary/5 text-primary hover:bg-primary/10"
                  : "bg-secondary text-muted-foreground hover:bg-secondary/80 hover:text-foreground",
            )}
          >
            {allSelected ? "全取消" : someSelected ? `已选 ${selectedInGroup} · 全选` : "全选"}
          </button>
        </div>
      </div>

      {!collapsed && (
        <ul className="space-y-0.5 px-1 pb-1 pt-0.5">
          {group.items.map((m) => {
            const checked = selectedSet.has(m.id);
            return (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={() => onToggleOne(m.id)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition hover:bg-secondary",
                    checked && "bg-primary/5",
                  )}
                >
                  <span
                    className={cn(
                      "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                      checked
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-background",
                    )}
                  >
                    {checked ? <Check className="h-3 w-3" /> : null}
                  </span>
                  {group.isPlatform ? (
                    <Sparkles className="h-3.5 w-3.5 shrink-0 text-primary/70" />
                  ) : (
                    <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  )}
                  <span className="flex-1 truncate" title={m.title}>
                    {m.title}
                  </span>
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    {m.chunk_count} 段
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
