"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { resolveAgentMeta, type AgentMeta } from "../agents";
import { agentsApi } from "../api";
import type { AgentType, UserAgent } from "../types";

/**
 * Phase 5: 拉取当前用户可见的所有老师 (平台 4 个 + 用户私有)。
 * 共享 cache key ['agents'],dashboard / chat / agents 页面用同一份数据。
 */
export function useAgents() {
  return useQuery<UserAgent[]>({
    queryKey: ["agents"],
    queryFn: () => agentsApi.list(),
    staleTime: 30_000,
  });
}

/** 单老师查询(用于 chat header 等场景) */
export function useAgentMeta(type: AgentType | undefined | null): AgentMeta | null {
  const { data } = useAgents();
  return useMemo(() => {
    if (!type) return null;
    return resolveAgentMeta(type, data);
  }, [type, data]);
}
