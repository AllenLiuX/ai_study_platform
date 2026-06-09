"use client";

import { AlertCircle, CheckCircle2, FileText, Loader2, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Material, ParseStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

interface MaterialCardProps {
  material: Material;
  onDelete: () => void;
  deleting?: boolean;
}

const TYPE_LABEL: Record<string, string> = {
  textbook: "课本",
  handout: "讲义",
  homework: "作业",
  exam: "试卷",
  note: "笔记",
  wrong_question: "错题",
  other: "其他",
};

export function MaterialCard({ material, onDelete, deleting }: MaterialCardProps) {
  const sizeKB = (material.size_bytes / 1024).toFixed(1);
  const ext = material.original_filename.split(".").pop()?.toUpperCase() ?? "";

  return (
    <div className="group relative flex flex-col gap-3 rounded-2xl border border-border/70 bg-card p-4 shadow-sm transition hover:shadow-card">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-100 to-violet-100 text-indigo-600">
          <FileText className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h4 className="truncate text-sm font-semibold" title={material.title}>
            {material.title}
          </h4>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {material.original_filename}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 opacity-0 transition group-hover:opacity-100"
          onClick={onDelete}
          disabled={deleting}
          title="删除"
        >
          {deleting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Trash2 className="h-4 w-4 text-destructive/80" />
          )}
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <StatusBadge status={material.parse_status} />
        {material.subject_id && (
          <Badge variant="secondary" className="text-[10px]">
            {subjectLabel(material.subject_id)}
          </Badge>
        )}
        <Badge variant="outline" className="text-[10px]">
          {TYPE_LABEL[material.material_type] ?? material.material_type}
        </Badge>
        <Badge variant="outline" className="text-[10px] uppercase">
          {ext}
        </Badge>
        <span className="ml-auto text-[10px] text-muted-foreground">
          {sizeKB} KB
        </span>
      </div>

      {material.parse_status === "ready" && (
        <p className="text-xs text-muted-foreground">
          已切片 {material.chunk_count} 段 · 在和老师对话时可勾选引用
        </p>
      )}
      {material.parse_status === "failed" && material.parse_error && (
        <p className="line-clamp-2 text-xs text-destructive" title={material.parse_error}>
          解析失败:{material.parse_error}
        </p>
      )}
      {material.summary && material.parse_status === "ready" && (
        <p className="line-clamp-2 text-xs text-muted-foreground/80">{material.summary}</p>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: ParseStatus }) {
  if (status === "ready") {
    return (
      <Badge className="gap-1 bg-emerald-100 text-emerald-700 hover:bg-emerald-100">
        <CheckCircle2 className="h-3 w-3" />
        可用
      </Badge>
    );
  }
  if (status === "failed") {
    return (
      <Badge variant="destructive" className="gap-1">
        <AlertCircle className="h-3 w-3" />
        失败
      </Badge>
    );
  }
  return (
    <Badge
      className={cn(
        "gap-1",
        status === "pending"
          ? "bg-amber-100 text-amber-700 hover:bg-amber-100"
          : "bg-sky-100 text-sky-700 hover:bg-sky-100",
      )}
    >
      <Loader2 className="h-3 w-3 animate-spin" />
      {status === "pending" ? "排队中" : "正在切片"}
    </Badge>
  );
}

function subjectLabel(id: string): string {
  // 简单中文化,后续可以从 subjects 列表反查
  if (id === "math") return "数学";
  if (id === "english") return "英语";
  if (id === "chinese") return "语文";
  return id;
}
