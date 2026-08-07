"use client";

import {
  ArrowUpRight,
  Headphones,
  Library,
  type LucideIcon,
  Map,
  Notebook,
  Target,
  Users,
  Wand2,
} from "lucide-react";
import Link from "next/link";

import { cn } from "@/lib/utils";

interface Shortcut {
  href: string;
  label: string;
  desc: string;
  icon: LucideIcon;
  isNew?: boolean;
}

const SHORTCUTS: Shortcut[] = [
  {
    href: "/roadmap",
    label: "学习规划",
    desc: "把大目标拆成可执行的学习路线，阶段成果可追踪。",
    icon: Map,
    isNew: true,
  },
  {
    href: "/lecture",
    label: "听课转写",
    desc: "边听边实时转写，一键整理成结构化复习笔记。",
    icon: Headphones,
    isNew: true,
  },
  {
    href: "/groups",
    label: "群组 / 班级",
    desc: "和班级、学习小组共享资料库与笔记，协作学习。",
    icon: Users,
    isNew: true,
  },
  {
    href: "/practice-studio",
    label: "练习工坊",
    desc: "描述想练什么，AI 造一台交互式训练器（模拟器/计时/跟读…），保存复用。",
    icon: Wand2,
    isNew: true,
  },
  {
    href: "/practice",
    label: "智能练习",
    desc: "AI 按你的薄弱点出题，即时讲评、查漏补缺。",
    icon: Target,
  },
  {
    href: "/materials",
    label: "资料库",
    desc: "上传教材与讲义，让 AI 基于你的材料作答引用。",
    icon: Library,
  },
  {
    href: "/notes",
    label: "知识笔记",
    desc: "沉淀关键知识点，自动参与后续检索与召回。",
    icon: Notebook,
  },
];

/** 驾驶舱底部的功能快捷入口，帮助用户发现规划 / 听课 / 群组等能力。 */
export function FeatureShortcuts() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {SHORTCUTS.map((s) => {
        const Icon = s.icon;
        return (
          <Link
            key={s.href}
            href={s.href}
            className="group relative flex flex-col rounded-2xl border border-border bg-card p-5 shadow-card transition hover:-translate-y-0.5 hover:border-primary/40"
          >
            <div className="mb-3 flex items-center justify-between">
              <span
                className={cn(
                  "flex h-10 w-10 items-center justify-center rounded-xl transition",
                  "bg-secondary text-foreground group-hover:bg-primary/10 group-hover:text-primary",
                )}
              >
                <Icon className="h-5 w-5" />
              </span>
              {s.isNew && (
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
                  New
                </span>
              )}
            </div>
            <div className="flex items-center gap-1 text-base font-semibold tracking-tight">
              {s.label}
              <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-primary" />
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{s.desc}</p>
          </Link>
        );
      })}
    </div>
  );
}
