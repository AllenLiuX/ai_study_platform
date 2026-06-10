// Phase 5: agent_type 不再固定 4 选 1,可以是平台/用户自定义老师的 agent_key
// 旧 4 个 key 仍有 first-class 支持(用于 lib/agents.ts fallback display)。
export type BuiltinAgentType =
  | "head_teacher"
  | "math_teacher"
  | "english_teacher"
  | "chinese_teacher";

export type AgentType = BuiltinAgentType | string;

export type Grade = "初一" | "初二" | "初三" | "高一" | "高二" | "高三";

// Phase 5: 学习者类型 — K12 学生 / 自由学习者
export type LearnerType = "k12_student" | "free_learner";

export interface StudentProfile {
  user_id: string;
  name: string | null;
  grade: Grade | null;
  school: string | null;
  textbook_version: string | null;
  target_exam: string | null;
  learning_goal: string | null;
  focus_subjects: string[];
  // Phase 5: 学习者类型 & 自由学习者的关注领域
  learner_type?: LearnerType;
  focus_domains?: string[];
  onboarding_completed: boolean;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface Subject {
  id: string;
  name: string;
  stage: string;
  description: string | null;
  sort_order: number;
}

export interface ChatSession {
  id: string;
  student_id: string;
  agent_type: AgentType;
  subject_id: string | null;
  title: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

// Phase 5: citation 现在可以来自 material 或 note
export type CitationSource = "material" | "note";

export interface Citation {
  /** Phase 5: 引用来源类型 (旧消息可能没有,默认按 material 处理) */
  source?: CitationSource;
  source_id?: string;
  source_title?: string;
  /** 兼容旧字段 — assistant_message 历史里仍是 material_id */
  material_id?: string;
  material_title?: string;
  /** Phase 5: 笔记引用 */
  note_id?: string;
  note_title?: string;
  chunk_index: number;
  similarity: number;
  snippet: string;
}

export type FollowUpType = "deep_dive" | "explore" | "practice" | "review";

export interface FollowUp {
  type: FollowUpType;
  question: string;
  knowledge_point?: string | null;
  reason?: string | null;
}

// Phase 3.5: 模型档位 (与后端 ModelTier 对齐)
export type ModelTierId =
  | "low"
  | "medium"
  | "high"
  | "extra_high"
  | "max";

export interface ModelTierInfo {
  tier: ModelTierId;
  /** 后端实际解析出的 OpenAI 模型名,例:gpt-4o-mini */
  model: string;
  /** 内部 label, 例 "extra-high" */
  label: string;
  /** 展示 label, 例 "Extra-high" */
  display: string;
  /** 能力等级 1-6 (展示用 dots) */
  capability: number;
  /** 相对成本 1-10 (展示用 dots) */
  cost: number;
  desc: string;
  is_default: boolean;
}

export interface ChatMessage {
  id?: string;
  session_id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  metadata?: {
    citations?: Citation[];
    material_ids?: string[];
    agent_type?: AgentType;
    model?: string;
    model_tier?: ModelTierId | string;
    follow_ups?: FollowUp[];
    /** Phase 4: 题目图片附件 — 值是 chat-attachments bucket 中的 storage_path */
    image_urls?: string[];
    [key: string]: unknown;
  };
  created_at?: string | null;
}

export interface WeakPoint {
  knowledge_point_id: string;
  name: string;
  parent_name: string | null;
  mastery: number;
  encounter_count: number;
}

export interface SubjectProgress {
  subject_id: string;
  subject_name: string;
  avg_mastery: number;
  covered_count: number;
  weak_count: number;
  current_chapter: string | null;
  weak_points: WeakPoint[];
}

// Phase 3: 今日推荐任务
export type DailyTaskTag = "薄弱" | "复习" | "新学" | "规划";

export interface DailyTask {
  id: string;
  title: string;
  description: string;
  subject_label: string;
  subject_id: string | null;
  agent_type: AgentType;
  estimated_minutes: number;
  tag: DailyTaskTag | string;
  starter_prompt: string;
  knowledge_point_ids: string[];
}

export interface DailyTasksResponse {
  tasks: DailyTask[];
  generated_at: string | null;
  model: string | null;
  cached: boolean;
}

export interface DashboardResponse {
  profile: StudentProfile;
  subjects: Subject[];
  recent_sessions: ChatSession[];
  progress: SubjectProgress[];
  tasks: DailyTasksResponse | null;
}

// Phase 1: 学习资料 (上传到 Supabase Storage,后端切片+向量化后供 RAG 检索)
export type ParseStatus = "pending" | "processing" | "ready" | "failed";
export type MaterialType =
  | "textbook"
  | "handout"
  | "homework"
  | "exam"
  | "note"
  | "wrong_question"
  | "other";

export interface Material {
  id: string;
  owner_type: "platform" | "student";
  owner_id: string | null;
  title: string;
  subject_id: string | null;
  grade: string | null;
  material_type: MaterialType;
  original_filename: string;
  mime_type: string;
  size_bytes: number;
  parse_status: ParseStatus;
  parse_error: string | null;
  summary: string | null;
  chunk_count: number;
  created_at: string;
  updated_at: string;
}

// -----------------------------------------------------------------------------
// Phase 5: 自定义老师 + 笔记 (= 私有知识点)
// -----------------------------------------------------------------------------
export type AgentOwnerType = "platform" | "user";

export interface UserAgent {
  id: string;
  owner_type: AgentOwnerType;
  owner_id: string | null;
  agent_key: string;
  display_name: string;
  emoji: string | null;
  tagline: string | null;
  role: string | null;
  system_prompt: string | null;
  starter_prompts: string[];
  default_material_ids: string[];
  domains: string[];
  default_model_tier: ModelTierId;
  subject_id: string | null;
  is_active: boolean;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface CreateUserAgentRequest {
  agent_key: string;
  display_name: string;
  emoji?: string | null;
  tagline?: string | null;
  role?: string | null;
  system_prompt: string;
  starter_prompts?: string[];
  default_material_ids?: string[];
  domains?: string[];
  default_model_tier?: ModelTierId;
  subject_id?: string | null;
}

export type UpdateUserAgentRequest = Partial<CreateUserAgentRequest> & {
  is_active?: boolean;
};

export interface GeneratedAgentSpec {
  display_name: string;
  emoji: string;
  tagline: string;
  role: string;
  system_prompt: string;
  starter_prompts: string[];
  domains: string[];
  suggested_model_tier: ModelTierId;
}

export type NoteSource = "chat" | "manual" | "imported";
export type NoteChunkStatus = "pending" | "processing" | "ready" | "failed";

export interface KnowledgeNote {
  id: string;
  owner_id: string;
  agent_key: string | null;
  origin_session_id: string | null;
  origin_message_id: string | null;
  title: string;
  content: string;
  summary: string | null;
  tags: string[];
  parent_id: string | null;
  mastery_score: number;
  review_count: number;
  last_reviewed_at: string | null;
  source: NoteSource;
  chunk_status: NoteChunkStatus;
  chunk_count: number;
  chunk_error: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface CreateNoteRequest {
  title: string;
  content: string;
  summary?: string;
  tags?: string[];
  parent_id?: string | null;
  agent_key?: string | null;
  origin_session_id?: string | null;
  origin_message_id?: string | null;
  source?: NoteSource;
}

export interface UpdateNoteRequest {
  title?: string;
  content?: string;
  summary?: string | null;
  tags?: string[];
  parent_id?: string | null;
  mastery_score?: number;
}
