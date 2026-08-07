"use client";

import {
  type AppTrainerSpec,
  isTrainerSpec,
  type PracticeSpec,
  type TemplateTrainerSpec,
} from "@/lib/practice/spec";

import { PracticeRunner } from "./PracticeRunner";
import { SandboxFrame } from "./SandboxFrame";
import { TrainerRenderer } from "./trainers/TrainerRenderer";

/**
 * 工坊运行入口：
 * - 新的交互式训练器：template → 内置训练器组件；app → 隔离 iframe。
 * - 旧的练习块 spec（历史记录）：回退到 PracticeRunner。
 */
export function TrainerRunner({
  spec,
  specId,
}: {
  spec: unknown;
  specId?: string;
}) {
  if (isTrainerSpec(spec)) {
    if (spec.kind === "app") {
      return <SandboxFrame html={(spec as AppTrainerSpec).html} />;
    }
    return <TrainerRenderer spec={spec as TemplateTrainerSpec} specId={specId} />;
  }
  return <PracticeRunner spec={spec as PracticeSpec} />;
}
