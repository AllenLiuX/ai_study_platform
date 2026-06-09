"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Library, Loader2 } from "lucide-react";
import { useEffect, useMemo } from "react";

import { AppHeader } from "@/components/AppHeader";
import { MaterialCard } from "@/components/MaterialCard";
import { MaterialUploader } from "@/components/MaterialUploader";
import { ModelBadge } from "@/components/ModelBadge";
import { Skeleton } from "@/components/ui/skeleton";
import { materialsApi, metaApi, studentApi } from "@/lib/api";
import type { Material } from "@/lib/types";

export default function MaterialsPage() {
  const queryClient = useQueryClient();

  const subjectsQuery = useQuery({
    queryKey: ["subjects"],
    queryFn: studentApi.getSubjects,
  });

  const materialsQuery = useQuery({
    queryKey: ["materials"],
    queryFn: materialsApi.list,
    // 后端处理是异步的,有在 processing 的资料时多刷新几次
    refetchInterval: (q) => {
      const list = (q.state.data as Material[] | undefined) ?? [];
      const stillCooking = list.some(
        (m) => m.parse_status === "pending" || m.parse_status === "processing",
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

  const materials = materialsQuery.data ?? [];
  const readyCount = useMemo(
    () => materials.filter((m) => m.parse_status === "ready").length,
    [materials],
  );
  const processingCount = useMemo(
    () =>
      materials.filter(
        (m) => m.parse_status === "pending" || m.parse_status === "processing",
      ).length,
    [materials],
  );

  // 上传成功后立刻刷新一次列表
  useEffect(() => {
    const sub = queryClient.getQueryCache().subscribe(() => undefined);
    return () => sub();
  }, [queryClient]);

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
          <h1 className="text-2xl font-bold tracking-tight">我的资料库</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            把课本章节、讲义、错题本、考试卷上传进来,AI 会把它们切片并向量化。
            之后在和班主任 / 学科老师对话时,可以勾选资料让 TA 基于你的内容回答,
            而不是泛泛而谈。
          </p>
          {materials.length > 0 && (
            <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
              <span>共 {materials.length} 份资料</span>
              <span className="text-border">·</span>
              <span className="flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                {readyCount} 份可用
              </span>
              {processingCount > 0 && (
                <>
                  <span className="text-border">·</span>
                  <span className="flex items-center gap-1 text-primary">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    {processingCount} 份 AI 处理中
                  </span>
                </>
              )}
            </div>
          )}
        </div>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
          <MaterialUploader
            subjects={subjectsQuery.data ?? []}
            embeddingModel={embeddingModel}
            onUploaded={(m) => {
              queryClient.setQueryData<Material[]>(["materials"], (prev) => [
                m,
                ...(prev ?? []),
              ]);
              queryClient.invalidateQueries({ queryKey: ["materials"] });
            }}
          />

          <section className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold text-muted-foreground">
              已上传
            </h2>
            {materialsQuery.isLoading ? (
              <div className="grid gap-3 sm:grid-cols-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-32 rounded-2xl" />
                ))}
              </div>
            ) : materials.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border/70 bg-background/40 p-10 text-center">
                <p className="text-sm font-medium">还没有上传过资料</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  上传第一份资料后,这里会列出所有可被 AI 老师引用的内容。
                </p>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {materials.map((m) => (
                  <MaterialCard
                    key={m.id}
                    material={m}
                    embeddingModel={embeddingModel}
                    onDelete={() => deleteMutation.mutate(m.id)}
                    deleting={
                      deleteMutation.isPending && deleteMutation.variables === m.id
                    }
                  />
                ))}
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
