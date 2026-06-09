"use client";

import {
  AlertCircle,
  CheckCircle2,
  FileText,
  Loader2,
  Sparkles,
  Trash2,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Material, ParseStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

interface MaterialCardProps {
  material: Material;
  onDelete: () => void;
  deleting?: boolean;
  /** 当前 embedding 模型,用来在状态徽章 / 摘要中显式标出 AI */
  embeddingModel?: string;
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

export function MaterialCard({
  material,
  onDelete,
  deleting,
  embeddingModel,
}: MaterialCardProps) {
  const sizeKB = (material.size_bytes / 1024).toFixed(1);
  const ext = material.original_filename.split(".").pop()?.toUpperCase() ?? "";

  return (
    <div className="group relative flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 shadow-card transition hover:-translate-y-0.5">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border bg-secondary text-muted-foreground">
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
          className="h-7 w-7 text-muted-foreground opacity-0 transition group-hover:opacity-100"
          onClick={onDelete}
          disabled={deleting}
          title="删除"
        >
          {deleting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Trash2 className="h-4 w-4" />
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
        <p className="flex items-center gap-1 text-xs text-muted-foreground">
          <Sparkles className="h-3 w-3 text-primary" />
          <span>
            AI 已切片 {material.chunk_count} 段
            {embeddingModel ? ` · ${embeddingModel}` : ""} · 对话时可勾选引用
          </span>
        </p>
      )}
      {(material.parse_status === "pending" ||
        material.parse_status === "processing") && (
        <p className="text-xs text-muted-foreground">
          {material.parse_status === "pending"
            ? "等待 AI 切片中"
            : `AI 正在向量化${embeddingModel ? " · " + embeddingModel : ""}`}
        </p>
      )}
      {material.parse_status === "failed" && material.parse_error && (
        <p
          className="line-clamp-2 text-xs text-destructive"
          title={material.parse_error}
        >
          解析失败:{material.parse_error}
        </p>
      )}
      {material.summary && material.parse_status === "ready" && (
        <p className="line-clamp-2 text-xs text-muted-foreground/80">
          {material.summary}
        </p>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: ParseStatus }) {
  if (status === "ready") {
    return (
      <Badge
        variant="outline"
        className="gap-1 border-emerald-200 bg-emerald-50 text-emerald-700"
      >
        <CheckCircle2 className="h-3 w-3" />
        可用
      </Badge>
    );
  }
  if (status === "failed") {
    return (
      <Badge
        variant="outline"
        className="gap-1 border-destructive/30 bg-destructive/5 text-destructive"
      >
        <AlertCircle className="h-3 w-3" />
        失败
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className={cn(
        "gap-1 border-primary/20 bg-primary/5 text-primary",
        status === "processing" && "animate-pulse",
      )}
    >
      <Loader2 className="h-3 w-3 animate-spin" />
      {status === "pending" ? "排队中" : "AI 切片中"}
    </Badge>
  );
}

function subjectLabel(id: string): string {
  if (id === "math") return "数学";
  if (id === "english") return "英语";
  if (id === "chinese") return "语文";
  return id;
}
