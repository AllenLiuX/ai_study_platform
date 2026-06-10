import type { AgentType, BuiltinAgentType, UserAgent } from "./types";

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
  /** Phase 5: 区分平台/用户自定义老师,前端样式可微调 */
  ownerType?: "platform" | "user";
  /** Phase 5: 自由领域 tags */
  domains?: string[];
  /** Phase 5: 老师默认绑定的资料 ids,Chat 进入时 MaterialPicker 默认勾选 */
  defaultMaterialIds?: string[];
}

// Phase 5: 内置 4 个老师 — 当 server 没拿到 dynamic agent 时仍作 fallback
export const AGENTS: Record<BuiltinAgentType, AgentMeta> = {
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

export const AGENT_ORDER: BuiltinAgentType[] = [
  "head_teacher",
  "math_teacher",
  "english_teacher",
  "chinese_teacher",
];

const BUILTIN_KEYS = new Set<string>(AGENT_ORDER);

export function isBuiltinAgent(type: string): type is BuiltinAgentType {
  return BUILTIN_KEYS.has(type);
}

export function getAgentMeta(type: AgentType): AgentMeta {
  if (isBuiltinAgent(type)) return AGENTS[type];
  // 用户自定义老师在被 dynamic load 之前会走这里 — 用一个保守 fallback,
  // 等 useAgents() 拉到 dynamic list 后会覆盖。
  return {
    type,
    displayName: type,
    shortName: type,
    subjectId: null,
    role: "AI 老师",
    emoji: "🎓",
    tagline: "你创建的专属 AI 老师",
    starterPrompts: [],
    ownerType: "user",
  };
}

export function getAgentBySubject(subjectId: string): AgentMeta | undefined {
  return Object.values(AGENTS).find((a) => a.subjectId === subjectId);
}

// Phase 5: 把 server 返回的 UserAgent 转成 AgentMeta,供 UI 复用同一形态
export function userAgentToMeta(ua: UserAgent): AgentMeta {
  return {
    type: ua.agent_key,
    displayName: ua.display_name,
    shortName: ua.display_name.length > 4 ? ua.display_name.slice(0, 4) : ua.display_name,
    subjectId: ua.subject_id,
    role: ua.role || "AI 老师",
    emoji: ua.emoji || "🎓",
    tagline: ua.tagline || "",
    starterPrompts: ua.starter_prompts ?? [],
    ownerType: ua.owner_type,
    domains: ua.domains,
    defaultMaterialIds: ua.default_material_ids,
  };
}

// Phase 5: 给定 dynamic agent list + agent_key,返回最佳 AgentMeta (dynamic 覆盖 hardcoded fallback)
export function resolveAgentMeta(
  type: AgentType,
  dynamicAgents: UserAgent[] | undefined,
): AgentMeta {
  if (dynamicAgents) {
    const hit = dynamicAgents.find((ua) => ua.agent_key === type);
    if (hit) return userAgentToMeta(hit);
  }
  return getAgentMeta(type);
}
