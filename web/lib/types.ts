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

// Phase 5: citation 来自 material 或 note
// Phase 5.5: 新增 "web" 来源 — 对话联网搜索 (Tavily) 拿到的网页
export type CitationSource = "material" | "note" | "web";

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
  /** Phase 5.5: web 来源 — url 直接给前端可点击 */
  url?: string;
  published_date?: string | null;
  /** 后端 extra 字段透传 (Tavily score / 笔记 tags / 等) */
  extra?: Record<string, unknown>;
  chunk_index: number;
  similarity: number;
  snippet: string;
}

// Phase 5.5: 对话联网搜索的 SSE 进度事件
export interface WebSearchResultPreview {
  title: string;
  url: string;
  snippet: string;
  score: number;
  published_date?: string | null;
}

export interface WebSearchEvent {
  status: "searching" | "done" | "error";
  query?: string;
  count?: number;
  response_time_ms?: number;
  message?: string;
  results?: WebSearchResultPreview[];
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
  roadmap_node_id?: string | null;
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

// Phase 9: 动态学习规划 / 科技树
export type RoadmapStatus = "draft" | "active" | "completed" | "archived";
export type RoadmapNodeStatus = "done" | "current" | "open" | "locked" | "review";

export interface RoadmapNode {
  id: string;
  title: string;
  description: string;
  phase: string;
  status: RoadmapNodeStatus;
  estimated_hours: number;
  prerequisites: string[];
  mastery_evidence: string[];
  mastery: number;
  next_action: string;
}

export interface RoadmapLane {
  id: string;
  title: string;
  purpose: string;
  nodes: RoadmapNode[];
}

export interface LearningRoadmap {
  id: string;
  owner_id: string;
  title: string;
  goal: string;
  baseline: string | null;
  target_date: string | null;
  weekly_hours: number;
  agent_key: string | null;
  status: RoadmapStatus;
  lanes: RoadmapLane[];
  version: number;
  generated_by_model: string | null;
  generation_context: Record<string, unknown>;
  created_at: string | null;
  updated_at: string | null;
}

export interface GenerateRoadmapRequest {
  goal: string;
  baseline?: string;
  weekly_hours?: number;
  target_date?: string | null;
  agent_key?: string | null;
  preferences?: string;
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
  /** Phase 7: 归属群 (null=个人资料) */
  group_id?: string | null;
  created_at: string;
  updated_at: string;
}

// -----------------------------------------------------------------------------
// Phase 8: Billing / Entitlements
// -----------------------------------------------------------------------------
export type PlanTier = "free" | "pro";

export interface UsageItem {
  key: string;
  label: string;
  used: number;
  limit: number | null;
  unlimited: boolean;
  exhausted: boolean;
  period: "day" | "total";
}

export interface MyPlan {
  plan: PlanTier;
  is_pro: boolean;
  expires_at: string | null;
  expired: boolean;
  raw_plan: PlanTier;
  granted_at: string | null;
  note: string | null;
  allowed_model_tiers: string[];
  usage: UsageItem[];
}

/**
 * 后端 402 Payment Required 的 detail 结构 (与 QuotaExceeded 对齐).
 */
export interface QuotaExceededDetail {
  message: string;
  limit_key: string;
  limit: number | string[] | null;
  used: number | string;
  upgrade_hint: string;
}

// -----------------------------------------------------------------------------
// Phase 7.1: Admin dashboard
// -----------------------------------------------------------------------------
export interface AdminMe {
  is_admin: boolean;
  email: string | null;
}

export interface AdminOverview {
  generated_at: string;
  users: {
    total: number;
    active_today: number;
    active_week: number;
    active_month: number;
  };
  content: {
    chat_messages_total: number;
    chat_messages_today: number;
    chat_sessions_total: number;
    materials_total: number;
    materials_student_total: number;
    notes_total: number;
    practice_sessions_total: number;
    groups_total: number;
    group_members_total: number;
  };
}

export interface AdminTrendPoint {
  date: string;
  new_users: number;
  messages: number;
  notes: number;
}

export interface AdminTrend {
  days: number;
  series: AdminTrendPoint[];
}

export interface AdminBreakdownItem {
  key: string;
  count: number;
}

export interface AdminBreakdown {
  notes_by_source: AdminBreakdownItem[];
  materials_by_type: AdminBreakdownItem[];
  materials_by_owner_type: AdminBreakdownItem[];
  messages_by_agent: AdminBreakdownItem[];
  groups_by_visibility: AdminBreakdownItem[];
  practice_by_status: AdminBreakdownItem[];
}

export interface AdminUserRow {
  user_id: string;
  email: string | null;
  display_name: string | null;
  grade: string | null;
  school: string | null;
  learning_goal: string | null;
  created_at: string | null;
  last_sign_in_at: string | null;
  messages: number;
  notes: number;
  materials: number;
  plan?: PlanTier;
  plan_expires_at?: string | null;
}

export interface AdminTopUser {
  user_id: string;
  email: string | null;
  display_name: string | null;
  grade: string | null;
  messages_30d: number;
}

// -----------------------------------------------------------------------------
// Phase 7: 群组 / 班级
// -----------------------------------------------------------------------------
export type GroupRole = "owner" | "admin" | "member";

export interface Group {
  id: string;
  name: string;
  description: string | null;
  invite_code: string;
  is_public: boolean;
  owner_id: string;
  member_count: number;
  emoji: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  /** list_my_groups 会附上; search 不带 */
  my_role?: GroupRole;
}

export interface GroupMember {
  user_id: string;
  role: GroupRole;
  joined_at?: string | null;
  display_name?: string | null;
  email?: string | null;
}

export interface GroupDetail extends Group {
  my_role: GroupRole;
  members_preview: GroupMember[];
  materials_count: number;
  notes_count: number;
}

export interface CreateGroupRequest {
  name: string;
  description?: string | null;
  is_public?: boolean;
  emoji?: string | null;
}

export interface UpdateGroupRequest {
  name?: string;
  description?: string | null;
  is_public?: boolean;
  emoji?: string | null;
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
  /** Phase 5: LLM 直接给的英文 slug,前端不再客户端转 — 中文 display_name 也能拿到可用 key */
  agent_key: string;
  display_name: string;
  emoji: string;
  tagline: string;
  role: string;
  system_prompt: string;
  starter_prompts: string[];
  domains: string[];
  suggested_model_tier: ModelTierId;
}

export type NoteSource = "chat" | "manual" | "imported" | "practice" | "lecture";
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
  /** Phase 7: 归属群 (null=个人笔记) */
  group_id?: string | null;
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
  /** Phase 7: 可选,新建到某个群 */
  group_id?: string | null;
}

export interface UpdateNoteRequest {
  title?: string;
  content?: string;
  summary?: string | null;
  tags?: string[];
  parent_id?: string | null;
  mastery_score?: number;
}

// ============================================================================
// Phase 6: 练习模块
// ============================================================================

export type PracticeQuestionKind = "mcq" | "multi_mcq" | "fill" | "short";
export type PracticeSessionStatus = "active" | "finished" | "abandoned";
export type PracticeDifficultyStrategy =
  | "adaptive"
  | "fixed_1"
  | "fixed_2"
  | "fixed_3"
  | "fixed_4"
  | "fixed_5";

export interface PracticeSession {
  id: string;
  owner_id: string;
  agent_key: string;
  topic: string;
  plan: string | null;
  target_minutes: number;
  target_question_count: number;
  allowed_kinds: PracticeQuestionKind[];
  difficulty_strategy: PracticeDifficultyStrategy;
  model_tier: ModelTierId;
  status: PracticeSessionStatus;
  summary: Record<string, unknown> | null;
  started_at?: string | null;
  finished_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  question_count: number;
  answered_count: number;
  correct_count: number;
}

export interface CreatePracticeSessionRequest {
  agent_key: string;
  topic: string;
  plan?: string | null;
  target_minutes: number;
  target_question_count: number;
  allowed_kinds: PracticeQuestionKind[];
  difficulty_strategy: PracticeDifficultyStrategy;
  model_tier: ModelTierId;
}

export interface PracticeOption {
  id: string;
  text: string;
}

export interface PracticeQuestion {
  id: string;
  session_id: string;
  idx: number;
  kind: PracticeQuestionKind;
  prompt: string;
  options: PracticeOption[] | null;
  explanation: string | null;
  difficulty: number;
  knowledge_points: string[];
  source: string;
  hints: string[];
  created_at?: string | null;
  // 复盘 / 续答时附:
  attempt?: PracticeAttempt | null;
  correct_answer?: unknown; // session 结束后,或学生已经作答时才暴露
}

export interface PracticeAttempt {
  id: string;
  question_id: string;
  user_answer: unknown;
  is_correct: boolean | null;
  score: number | null;
  feedback: string | null;
  skipped: boolean;
  time_spent_ms: number | null;
  hints_used: number;
  created_at?: string | null;
}

export interface SubmitAttemptRequest {
  user_answer?: unknown;
  skipped?: boolean;
  time_spent_ms?: number;
  hints_used?: number;
}

export interface AttemptResult {
  attempt: PracticeAttempt;
  correct_answer: unknown;
  explanation: string | null;
  knowledge_points: string[];
}

export interface NextQuestionResponse {
  question: PracticeQuestion | null;
  is_session_complete: boolean;
  reason: string | null;
}

export interface HintResponse {
  hint: string;
  hint_level: number;
}

export interface FinishSessionResponse {
  session: PracticeSession;
  summary_markdown: string;
  stats: {
    answered: number;
    correct: number;
    wrong: number;
    accuracy: number;
    total_questions: number;
    kp_stats: Record<string, { correct: number; wrong: number }>;
  };
}
