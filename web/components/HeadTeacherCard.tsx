"use client";

import { Compass, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { AGENTS } from "@/lib/agents";

export function HeadTeacherCard({ onEnter }: { onEnter?: () => void }) {
  const agent = AGENTS.head_teacher;
  return (
    <Card className="relative overflow-hidden border-indigo-200/60 bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500 text-white shadow-lg">
      <CardContent className="relative flex flex-col gap-6 p-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm/none text-white/80">
            <Sparkles className="h-4 w-4" />
            <span>AI 学习教练</span>
          </div>
          <h2 className="text-2xl font-semibold sm:text-3xl">
            {agent.displayName} {agent.emoji}
          </h2>
          <p className="max-w-xl text-sm/relaxed text-white/85">
            {agent.tagline}。和我聊聊这一周怎么安排,我帮你列清单、找重点、控节奏。
          </p>
        </div>
        <Button
          size="lg"
          variant="accent"
          className="self-start sm:self-center"
          onClick={onEnter}
        >
          <Compass className="mr-1 h-5 w-5" />
          找班主任规划一下
        </Button>
      </CardContent>
      <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/15 blur-2xl" />
      <div className="pointer-events-none absolute -bottom-12 right-20 h-32 w-32 rounded-full bg-amber-400/30 blur-2xl" />
    </Card>
  );
}
