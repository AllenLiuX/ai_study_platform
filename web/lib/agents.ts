import type { AgentType } from "./types";

export interface AgentMeta {
  type: AgentType;
  displayName: string;
  shortName: string;
  subjectId: string | null;
  /** Tailwind 渐变色,用于卡片/头像 */
  gradient: string;
  /** 强调色,用于按钮 hover、徽章 */
  accent: string;
  emoji: string;
  /** 一句话描述 */
  tagline: string;
  /** 引导提问示例 */
  starterPrompts: string[];
}

export const AGENTS: Record<AgentType, AgentMeta> = {
  head_teacher: {
    type: "head_teacher",
    displayName: "AI 班主任",
    shortName: "班主任",
    subjectId: null,
    gradient: "from-indigo-500 to-violet-500",
    accent: "text-indigo-600",
    emoji: "🧭",
    tagline: "帮你做规划、汇总薄弱点、安排学习节奏",
    starterPrompts: [
      "帮我看看这周怎么安排数学和英语",
      "下个月期中考试,帮我做个冲刺计划",
      "最近学习效率有点低,你能帮我分析吗?",
    ],
  },
  math_teacher: {
    type: "math_teacher",
    displayName: "数学老师",
    shortName: "数学",
    subjectId: "math",
    gradient: "from-blue-500 to-cyan-500",
    accent: "text-blue-600",
    emoji: "📐",
    tagline: "讲解概念、分步推导、引导独立思考",
    starterPrompts: [
      "一次函数为什么是一条直线?",
      "我不会因式分解,帮我从头讲一下",
      "这道方程应用题怎么列式?",
    ],
  },
  english_teacher: {
    type: "english_teacher",
    displayName: "英语老师",
    shortName: "英语",
    subjectId: "english",
    gradient: "from-emerald-500 to-teal-500",
    accent: "text-emerald-600",
    emoji: "✍️",
    tagline: "讲语法、改作文、分析阅读、讲单词",
    starterPrompts: [
      "现在完成时和一般过去时有什么区别?",
      "帮我改一下这段英语作文",
      "这篇阅读为什么选 B?",
    ],
  },
  chinese_teacher: {
    type: "chinese_teacher",
    displayName: "语文老师",
    shortName: "语文",
    subjectId: "chinese",
    gradient: "from-rose-500 to-orange-500",
    accent: "text-rose-600",
    emoji: "📖",
    tagline: "阅读理解、文言文、古诗词、作文构思",
    starterPrompts: [
      "这篇阅读的中心思想是什么?",
      "文言文这句话怎么翻译?",
      "作文怎么开头更好?",
    ],
  },
};

export const AGENT_ORDER: AgentType[] = [
  "head_teacher",
  "math_teacher",
  "english_teacher",
  "chinese_teacher",
];

export function getAgentMeta(type: AgentType): AgentMeta {
  return AGENTS[type];
}

export function getAgentBySubject(subjectId: string): AgentMeta | undefined {
  return Object.values(AGENTS).find((a) => a.subjectId === subjectId);
}
