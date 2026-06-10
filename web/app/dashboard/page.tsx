"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo } from "react";

import { AppHeader } from "@/components/AppHeader";
import { HeadTeacherCard } from "@/components/HeadTeacherCard";
import { RecentSessionsCard } from "@/components/RecentSessionsCard";
import { StudentHeader } from "@/components/StudentHeader";
import { SubjectProgressCard } from "@/components/SubjectProgressCard";
import { TaskCard } from "@/components/TaskCard";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AGENTS, AGENT_ORDER } from "@/lib/agents";
import { chatApi, metaApi, studentApi } from "@/lib/api";
import type { AgentType, DailyTask } from "@/lib/types";

export default function DashboardPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const dashboardQuery = useQuery({
    queryKey: ["dashboard"],
    queryFn: studentApi.getDashboard,
  });

  const configQuery = useQuery({
    queryKey: ["meta-config"],
    queryFn: metaApi.config,
    staleTime: 5 * 60_000,
  });
  const models = configQuery.data?.models;
  const modelStack = models
    ? `${models.default} · ${models.premium} · ${models.embedding}`
    : undefined;

  const refreshTasks = useMutation({
    mutationFn: () => studentApi.getTodayTasks(true),
    onSuccess: (data) => {
      queryClient.setQueryData(["dashboard"], (old: typeof dashboardQuery.data) =>
        old ? { ...old, tasks: data } : old,
      );
    },
  });

  useEffect(() => {
    if (dashboardQuery.data?.profile.onboarding_completed === false) {
      router.replace("/onboarding");
    }
  }, [dashboardQuery.data, router]);

  const tasksPayload = dashboardQuery.data?.tasks;
  const tasks = useMemo<DailyTask[]>(
    () => tasksPayload?.tasks ?? [],
    [tasksPayload],
  );

  async function enterAgent(type: AgentType) {
    try {
      const agent = AGENTS[type];
      const session = await chatApi.createSession({
        agent_type: type,
        subject_id: agent.subjectId,
      });
      router.push(`/chat/${session.id}`);
    } catch (err) {
      alert(err instanceof Error ? err.message : "无法创建对话,请稍后再试");
    }
  }

  async function startTask(task: DailyTask) {
    try {
      const session = await chatApi.createSession({
        agent_type: task.agent_type,
        subject_id: task.subject_id ?? null,
        title: task.title.slice(0, 20),
      });
      const promptParam = encodeURIComponent(task.starter_prompt);
      router.push(`/chat/${session.id}?prompt=${promptParam}`);
    } catch (err) {
      alert(err instanceof Error ? err.message : "无法开始任务,请稍后再试");
    }
  }

  return (
    <div className="min-h-screen bg-app-gradient">
      <AppHeader />
      <main className="container py-8">
        {dashboardQuery.isLoading ? (
          <DashboardSkeleton />
        ) : dashboardQuery.isError ? (
          <ErrorState message={(dashboardQuery.error as Error).message} />
        ) : dashboardQuery.data ? (
          <div className="space-y-8 animate-fade-in">
            <StudentHeader
              profile={dashboardQuery.data.profile}
              modelStack={modelStack}
            />

            <section className="space-y-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-lg font-semibold tracking-tight">
                  今日推荐任务
                </h2>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span>
                    {tasksPayload?.model ? (
                      <>
                        AI 班主任 ·{" "}
                        <span className="font-mono">{tasksPayload.model}</span>{" "}
                        基于你的进度生成
                      </>
                    ) : tasks.length > 0 ? (
                      "新用户默认清单 · 多聊几轮后会按你的薄弱点重新生成"
                    ) : (
                      "稍候,AI 正在为你规划"
                    )}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => refreshTasks.mutate()}
                    disabled={refreshTasks.isPending}
                  >
                    {refreshTasks.isPending ? (
                      <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="mr-1 h-3.5 w-3.5" />
                    )}
                    换一组
                  </Button>
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {tasks.length === 0 ? (
                  <>
                    <Skeleton className="h-40" />
                    <Skeleton className="h-40" />
                    <Skeleton className="h-40" />
                  </>
                ) : (
                  tasks.map((t) => (
                    <TaskCard
                      key={t.id}
                      task={t}
                      modelLabel={tasksPayload?.model ?? undefined}
                      onClick={() => startTask(t)}
                    />
                  ))
                )}
              </div>
            </section>

            <section className="space-y-3">
              <SectionTitle title="班主任" />
              <HeadTeacherCard
                onEnter={() => enterAgent("head_teacher")}
                modelLabel={models?.default}
              />
            </section>

            <section className="space-y-3">
              <SectionTitle
                title="各科学习进度"
                hint="由 AI 在每次对话后自动抽取知识点 + 掌握度"
              />
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {AGENT_ORDER.filter((t) => AGENTS[t].subjectId).map((type) => {
                  const agent = AGENTS[type];
                  const progress = dashboardQuery.data?.progress?.find(
                    (p) => p.subject_id === agent.subjectId,
                  );
                  return (
                    <SubjectProgressCard
                      key={type}
                      agent={agent}
                      progress={progress}
                      modelLabel={models?.default}
                      onEnter={() => enterAgent(type)}
                    />
                  );
                })}
              </div>
            </section>

            <section>
              <RecentSessionsCard
                sessions={dashboardQuery.data.recent_sessions}
              />
            </section>
          </div>
        ) : null}
      </main>
    </div>
  );
}

function SectionTitle({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-8">
      <Skeleton className="h-44" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Skeleton className="h-40" />
        <Skeleton className="h-40" />
        <Skeleton className="h-40" />
      </div>
      <Skeleton className="h-32" />
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-6 text-sm text-destructive">
      <p className="font-medium">无法加载 Dashboard 数据</p>
      <p className="mt-1 text-destructive/80">{message}</p>
      <p className="mt-3 text-xs text-muted-foreground">
        检查清单:后端 (uvicorn) 是否已启动 · Supabase Keys 是否填好 · 数据库
        migration 是否执行 · CORS 配置是否允许 http://localhost:3000
      </p>
    </div>
  );
}
