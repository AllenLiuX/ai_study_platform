"use client";

import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { AgentForm } from "@/components/AgentForm";
import { AppHeader } from "@/components/AppHeader";
import { agentsApi } from "@/lib/api";
import type { CreateUserAgentRequest, UserAgent } from "@/lib/types";

export default function NewAgentPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate(
    payload: CreateUserAgentRequest | Partial<CreateUserAgentRequest>,
  ) {
    setSubmitting(true);
    setError(null);
    try {
      const agent = await agentsApi.create(payload as CreateUserAgentRequest);
      queryClient.setQueryData<UserAgent[]>(["agents"], (prev) => {
        const list = prev ? [...prev] : [];
        return [...list, agent];
      });
      queryClient.invalidateQueries({ queryKey: ["agents"] });
      router.replace(`/agents`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建失败");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-app-gradient">
      <AppHeader />
      <div className="container max-w-3xl py-8">
        <Link
          href="/agents"
          className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          返回老师列表
        </Link>
        <h1 className="mb-1 text-2xl font-semibold tracking-tight">
          新建一位 AI 老师
        </h1>
        <p className="mb-6 text-sm text-muted-foreground">
          配置角色 + system prompt + 默认资料绑定;创建后就能在对话里使用。
        </p>
        <AgentForm
          initial={null}
          onSubmit={handleCreate}
          submitting={submitting}
          submitError={error}
        />
      </div>
    </div>
  );
}
