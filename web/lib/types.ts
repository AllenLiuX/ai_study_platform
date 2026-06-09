export type AgentType =
  | "head_teacher"
  | "math_teacher"
  | "english_teacher"
  | "chinese_teacher";

export type Grade = "初一" | "初二" | "初三" | "高一" | "高二" | "高三";

export interface StudentProfile {
  user_id: string;
  name: string | null;
  grade: Grade | null;
  school: string | null;
  textbook_version: string | null;
  target_exam: string | null;
  learning_goal: string | null;
  focus_subjects: string[];
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

export interface Citation {
  material_id: string;
  material_title: string;
  chunk_index: number;
  similarity: number;
  snippet: string;
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
    model_tier?: string;
    [key: string]: unknown;
  };
  created_at?: string | null;
}

export interface DashboardResponse {
  profile: StudentProfile;
  subjects: Subject[];
  recent_sessions: ChatSession[];
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
