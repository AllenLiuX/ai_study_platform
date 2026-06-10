"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Loader2, RefreshCw, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

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
import { useAgents } from "@/lib/hooks/useAgents";
import type { AgentType, ChatSession, DailyTask } from "@/lib/types";
import Link from "next/link";
import { ArrowRight, GraduationCap, Notebook } from "lucide-react";

export default function DashboardPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const dashboardQuery = useQuery({
    queryKey: ["dashboard"],
    queryFn: studentApi.getDashboard,
  });
  const agentsQuery = useAgents();

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

  // 跳转中状态:点击一张卡 → 立即标记 → 显示 spinner + 阻止重复点击
  // creatingKey 形如 "agent:math_teacher" / "task:<task_id>",同一时间只允许 1 个进行中
  const [creatingKey, setCreatingKey] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const creatingRef = useRef<string | null>(null);

  async function openSession(
    key: string,
    factory: () => Promise<{ session: ChatSession; queryAppend?: string }>,
  ) {
    if (creatingRef.current) return; // 防双点
    creatingRef.current = key;
    setCreatingKey(key);
    setOpenError(null);
    try {
      const { session, queryAppend } = await factory();
      // *** 关键 ***:立即把新 session 写入 react-query 的 ["chat-sessions"] 缓存。
      // 否则 chat 页 mount 时 sessionsQuery.data 还是 stale list (没有新 session),
      // 触发 "session 不存在 → router.replace('/dashboard')",造成"点了又跳回当前页"。
      queryClient.setQueryData<ChatSession[]>(["chat-sessions"], (prev) => {
        const list = prev ?? [];
        return [session, ...list.filter((s) => s.id !== session.id)];
      });
      // 异步刷新一次,保证后续 dashboard / sidebar 数据同步
      void queryClient.invalidateQueries({ queryKey: ["chat-sessions"] });
      // 同时占位 messages cache (新 session 的 welcome 消息会由 chat 页 fetch 拿到完整版本)
      queryClient.setQueryData(["chat-messages", session.id], []);
      // push 之后我们不主动清 creatingKey — 让 spinner 持续到新页加载完(避免闪烁)
      router.push(`/chat/${session.id}${queryAppend ?? ""}`);
    } catch (err) {
      creatingRef.current = null;
      setCreatingKey(null);
      setOpenError(
        err instanceof Error ? err.message : "无法打开对话,请稍后再试",
      );
    }
  }

  function enterAgent(type: AgentType) {
    const agent = AGENTS[type as keyof typeof AGENTS];
    void openSession(`agent:${type}`, async () => {
      const session = await chatApi.createSession({
        agent_type: type,
        subject_id: agent?.subjectId ?? null,
      });
      return { session };
    });
  }

  function startTask(task: DailyTask) {
    void openSession(`task:${task.id}`, async () => {
      const session = await chatApi.createSession({
        agent_type: task.agent_type,
        subject_id: task.subject_id ?? null,
        title: task.title.slice(0, 20),
      });
      return {
        session,
        queryAppend: `?prompt=${encodeURIComponent(task.starter_prompt)}`,
      };
    });
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

            {openError && (
              <div className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-2.5 text-sm text-destructive">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="flex-1">
                  <div className="font-medium">打开对话失败</div>
                  <div className="text-xs text-destructive/80">{openError}</div>
                </div>
                <button
                  type="button"
                  onClick={() => setOpenError(null)}
                  className="rounded p-1 text-destructive/60 hover:bg-destructive/10"
                  aria-label="关闭"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}

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
                      busy={creatingKey === `task:${t.id}`}
                    />
                  ))
                )}
              </div>
            </section>

            {dashboardQuery.data.profile.learner_type === "free_learner" ? (
              <FreeLearnerSection
                agentsCount={
                  (agentsQuery.data ?? []).filter(
                    (a) => a.owner_type === "user" && a.is_active,
                  ).length
                }
                onEnter={(key: string) => enterAgent(key as AgentType)}
                creatingKey={creatingKey}
                modelDefault={models?.default}
              />
            ) : (
              <>
                <section className="space-y-3">
                  <SectionTitle title="班主任" />
                  <HeadTeacherCard
                    onEnter={() => enterAgent("head_teacher")}
                    modelLabel={models?.default}
                    busy={creatingKey === "agent:head_teacher"}
                  />
                </section>

                <section className="space-y-3">
                  <SectionTitle
                    title="各科学习进度"
                    hint="由 AI 在每次对话后自动抽取知识点 + 掌握度"
                  />
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {AGENT_ORDER.filter((t) => AGENTS[t].subjectId).map(
                      (type) => {
                        const agent = AGENTS[type];
                        const progress =
                          dashboardQuery.data?.progress?.find(
                            (p) => p.subject_id === agent.subjectId,
                          );
                        return (
                          <SubjectProgressCard
                            key={type}
                            agent={agent}
                            progress={progress}
                            modelLabel={models?.default}
                            onEnter={() => enterAgent(type)}
                            busy={creatingKey === `agent:${type}`}
                          />
                        );
                      },
                    )}
                  </div>
                </section>
              </>
            )}

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

function FreeLearnerSection({
  agentsCount,
  onEnter,
  creatingKey,
  modelDefault,
}: {
  agentsCount: number;
  onEnter: (key: string) => void;
  creatingKey: string | null;
  modelDefault?: string;
}) {
  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <SectionTitle
          title="我的 AI 老师团"
          hint="为不同方向各配一位专属老师,每位老师可挂自己的资料库"
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <HeadTeacherCard
            onEnter={() => onEnter("head_teacher")}
            modelLabel={modelDefault}
            busy={creatingKey === "agent:head_teacher"}
          />
          <Link
            href="/agents"
            className="group flex flex-col justify-between rounded-3xl border border-dashed border-border bg-card/40 p-6 transition hover:border-primary/40"
          >
            <div>
              <div className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-primary">
                <GraduationCap className="h-3 w-3" />
                自定义老师 · {agentsCount}
              </div>
              <h3 className="text-lg font-semibold tracking-tight">
                + 创建 / 管理你的专属老师
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                为面试、转岗、自学新领域各配一位 AI 老师 — 自定义角色、
                绑定资料库、AI 帮你生成 system prompt。
              </p>
            </div>
            <div className="mt-4 inline-flex items-center gap-1 text-sm text-primary">
              进入老师管理
              <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" />
            </div>
          </Link>
        </div>
      </section>

      <section>
        <Link
          href="/notes"
          className="group flex items-center justify-between rounded-2xl border border-border bg-card p-4 shadow-card transition hover:border-primary/40"
        >
          <div>
            <div className="mb-1 inline-flex items-center gap-1.5 text-xs font-medium text-primary">
              <Notebook className="h-3.5 w-3.5" />
              知识点笔记
            </div>
            <div className="text-sm font-medium">
              在对话中沉淀知识点,自动参与 RAG 召回
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              每条 AI 回答下点「保存为笔记」,AI 会蒸馏成结构化 markdown,
              下次再聊到这块自动召回。
            </div>
          </div>
          <ArrowRight className="h-4 w-4 text-muted-foreground transition group-hover:translate-x-0.5" />
        </Link>
      </section>
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
