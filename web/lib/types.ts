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

export interface ChatMessage {
  id?: string;
  session_id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  metadata?: Record<string, unknown>;
  created_at?: string | null;
}

export interface DashboardResponse {
  profile: StudentProfile;
  subjects: Subject[];
  recent_sessions: ChatSession[];
}
