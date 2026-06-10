"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Loader2 } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";

import { AgentForm } from "@/components/AgentForm";
import { AppHeader } from "@/components/AppHeader";
import { agentsApi } from "@/lib/api";
import type { UpdateUserAgentRequest, UserAgent } from "@/lib/types";

export default function EditAgentPage() {
  const params = useParams();
  const agentKey = String(params?.agentKey ?? "");
  const router = useRouter();
  const queryClient = useQueryClient();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const agentQuery = useQuery<UserAgent>({
    queryKey: ["agent", agentKey],
    queryFn: () => agentsApi.get(agentKey),
    enabled: !!agentKey,
  });

  async function handleUpdate(
    payload: UpdateUserAgentRequest | Partial<UpdateUserAgentRequest>,
  ) {
    setSubmitting(true);
    setError(null);
    try {
      const updated = await agentsApi.update(
        agentKey,
        payload as UpdateUserAgentRequest,
      );
      queryClient.setQueryData(["agent", agentKey], updated);
      queryClient.setQueryData<UserAgent[]>(["agents"], (prev) =>
        prev?.map((a) => (a.agent_key === agentKey ? updated : a)) ?? prev,
      );
      router.replace("/agents");
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
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
          编辑老师
        </h1>
        {agentQuery.isLoading ? (
          <div className="flex items-center gap-2 py-12 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            加载中…
          </div>
        ) : agentQuery.error ? (
          <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {(agentQuery.error as Error).message}
          </p>
        ) : agentQuery.data ? (
          agentQuery.data.owner_type === "platform" ? (
            <p className="rounded-lg bg-secondary px-3 py-2 text-sm text-muted-foreground">
              平台预设老师不可编辑。
            </p>
          ) : (
            <AgentForm
              initial={agentQuery.data}
              onSubmit={handleUpdate}
              submitting={submitting}
              submitError={error}
            />
          )
        ) : null}
      </div>
    </div>
  );
}
