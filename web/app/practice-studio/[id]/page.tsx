"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Loader2, Target } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef } from "react";

import { AppHeader } from "@/components/AppHeader";
import { TrainerRefinePanel } from "@/components/practice-studio/TrainerRefinePanel";
import { TrainerRunner } from "@/components/practice-studio/TrainerRunner";
import { practiceStudioApi } from "@/lib/api";

export default function PracticeStudioRunPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const markedRef = useRef(false);
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["practice-studio", id],
    queryFn: () => practiceStudioApi.get(id as string),
    enabled: !!id,
  });

  const markUsed = useMutation({
    mutationFn: () => practiceStudioApi.markUsed(id as string),
  });

  // 打开即记一次使用（每次挂载仅一次）
  useEffect(() => {
    if (id && query.data && !markedRef.current) {
      markedRef.current = true;
      markUsed.mutate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, query.data]);

  const rec = query.data;

  return (
    <div className="min-h-dvh bg-app-gradient">
      <AppHeader />
      <main className="container max-w-3xl space-y-5 py-6">
        <Link
          href="/practice-studio"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground transition hover:text-primary"
        >
          <ArrowLeft className="h-4 w-4" />
          练习工坊
        </Link>

        {query.isLoading ? (
          <div className="flex items-center gap-2 py-16 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            加载中…
          </div>
        ) : query.isError || !rec ? (
          <div className="rounded-2xl border border-dashed border-border bg-card/50 p-8 text-center text-sm text-muted-foreground">
            练习不存在或已被删除。
          </div>
        ) : (
          <>
            <header className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-semibold tracking-tight">
                  {rec.title}
                </h1>
                <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium text-secondary-foreground">
                  {rec.domain || "通用"}
                </span>
              </div>
              {rec.description && (
                <p className="text-sm text-muted-foreground">{rec.description}</p>
              )}
            </header>

            {rec.spec && "goal" in rec.spec && rec.spec.goal && (
              <div className="flex items-start gap-2 rounded-xl border border-primary/20 bg-primary/5 p-3">
                <Target className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <div>
                  <div className="text-xs font-semibold text-primary">训练目标</div>
                  <p className="text-sm leading-5">{rec.spec.goal}</p>
                </div>
              </div>
            )}

            <TrainerRunner
              key={rec.updated_at ?? rec.id}
              spec={rec.spec}
              specId={rec.id}
            />

            <TrainerRefinePanel
              specId={rec.id}
              onUpdated={(updated) => {
                queryClient.setQueryData(["practice-studio", id], updated);
                queryClient.invalidateQueries({ queryKey: ["practice-studios"] });
              }}
            />
          </>
        )}
      </main>
    </div>
  );
}
