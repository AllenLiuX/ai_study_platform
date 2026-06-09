import type { AgentType } from "./types";

export interface AgentMeta {
  type: AgentType;
  displayName: string;
  shortName: string;
  subjectId: string | null;
  /**
   * 角色定位:用于在 chat 顶栏显示 "AI · <role>"。
   * 设计上不再用彩色渐变,所有 Agent 共享同一品牌色,靠 emoji + 名字 + 角色定位区分。
   */
  role: string;
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
    role: "学习规划与全局诊断",
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
    role: "数学讲解与分步推导",
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
    role: "英语语法、阅读与作文",
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
    role: "语文阅读、文言与作文",
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
