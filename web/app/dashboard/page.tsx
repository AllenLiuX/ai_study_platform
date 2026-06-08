"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { AppHeader } from "@/components/AppHeader";
import { HeadTeacherCard } from "@/components/HeadTeacherCard";
import { RecentSessionsCard } from "@/components/RecentSessionsCard";
import { StudentHeader } from "@/components/StudentHeader";
import { SubjectProgressCard } from "@/components/SubjectProgressCard";
import { TaskCard, type TaskCardData } from "@/components/TaskCard";
import { Skeleton } from "@/components/ui/skeleton";
import { AGENTS, AGENT_ORDER } from "@/lib/agents";
import { chatApi, studentApi } from "@/lib/api";
import type { AgentType } from "@/lib/types";

const PLACEHOLDER_TASKS: TaskCardData[] = [
  {
    title: "和班主任聊聊本周怎么安排",
    description:
      "5 分钟同步一下你这周的考试 / 作业,班主任会帮你列出每天 1-2 件最重要的事。",
    subject: "学习规划",
    estimatedMinutes: 5,
    accent: "primary",
    tag: "必做",
  },
  {
    title: "找数学老师讲一个最近卡住的知识点",
    description:
      "从一道题切入,我们一步一步把这一类题型搞清楚。",
    subject: "数学",
    estimatedMinutes: 20,
    accent: "amber",
    tag: "薄弱",
  },
  {
    title: "找英语老师做一段语法或阅读训练",
    description: "可以丢一句不会的句子给我,也可以发一段阅读题。",
    subject: "英语",
    estimatedMinutes: 15,
    accent: "emerald",
    tag: "复习",
  },
];

export default function DashboardPage() {
  const router = useRouter();
  const dashboardQuery = useQuery({
    queryKey: ["dashboard"],
    queryFn: studentApi.getDashboard,
  });

  useEffect(() => {
    if (dashboardQuery.data?.profile.onboarding_completed === false) {
      router.replace("/onboarding");
    }
  }, [dashboardQuery.data, router]);

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
            <StudentHeader profile={dashboardQuery.data.profile} />

            <section className="space-y-3">
              <SectionTitle
                title="今日推荐任务"
                hint="Phase 0 占位 · 算法将在 Phase 3 接入"
              />
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {PLACEHOLDER_TASKS.map((t, idx) => (
                  <TaskCard
                    key={idx}
                    task={t}
                    onClick={() => {
                      // 第一张任务卡片是班主任,后面的对应学科
                      const map: AgentType[] = [
                        "head_teacher",
                        "math_teacher",
                        "english_teacher",
                      ];
                      enterAgent(map[idx] ?? "head_teacher");
                    }}
                  />
                ))}
              </div>
            </section>

            <section className="space-y-3">
              <SectionTitle title="班主任" />
              <HeadTeacherCard onEnter={() => enterAgent("head_teacher")} />
            </section>

            <section className="space-y-3">
              <SectionTitle
                title="各科学习进度"
                hint="Phase 0 用占位数据 · 真实数据将在 Phase 2 接入"
              />
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {AGENT_ORDER.filter((t) => AGENTS[t].subjectId).map((type) => (
                  <SubjectProgressCard
                    key={type}
                    agent={AGENTS[type]}
                    onEnter={() => enterAgent(type)}
                  />
                ))}
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
