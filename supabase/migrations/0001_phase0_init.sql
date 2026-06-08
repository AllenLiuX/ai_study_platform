-- =============================================================================
-- 学生学习驾驶舱 - Phase 0 初始化 migration
-- 在 Supabase SQL Editor 中执行此文件即可创建 Phase 0 所需的表和策略
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 扩展
-- -----------------------------------------------------------------------------
-- Phase 1 RAG 用到向量,先开起来不会带来开销
create extension if not exists vector;

-- -----------------------------------------------------------------------------
-- subjects: 学科字典 (公共数据)
-- -----------------------------------------------------------------------------
create table if not exists public.subjects (
    id text primary key,
    name text not null,
    stage text not null check (stage in ('junior_high', 'senior_high')),
    description text,
    sort_order int not null default 0,
    created_at timestamptz not null default now()
);

comment on table public.subjects is '学科字典,平台公共数据';

-- -----------------------------------------------------------------------------
-- student_profiles: 学生画像,与 auth.users 一对一
-- -----------------------------------------------------------------------------
create table if not exists public.student_profiles (
    user_id uuid primary key references auth.users(id) on delete cascade,
    name text,
    grade text,                   -- 例: 初一 / 初二 / 初三 / 高一 / 高二 / 高三
    school text,
    textbook_version text,        -- 例: 人教版 / 北师大版 / 译林版 等
    target_exam text,             -- 例: 月考 / 期中 / 期末 / 中考 / 高考
    learning_goal text,           -- 学习目标的自然语言描述
    focus_subjects text[] default '{}',
    onboarding_completed boolean not null default false,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

comment on table public.student_profiles is '学生画像,通过 user_id 关联 auth.users';

create or replace function public.set_updated_at()
returns trigger as $$
begin
    new.updated_at = now();
    return new;
end;
$$ language plpgsql;

drop trigger if exists trg_student_profiles_updated_at on public.student_profiles;
create trigger trg_student_profiles_updated_at
    before update on public.student_profiles
    for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- chat_sessions: 会话
-- -----------------------------------------------------------------------------
create table if not exists public.chat_sessions (
    id uuid primary key default gen_random_uuid(),
    student_id uuid not null references auth.users(id) on delete cascade,
    agent_type text not null check (agent_type in (
        'head_teacher', 'math_teacher', 'english_teacher', 'chinese_teacher'
    )),
    subject_id text references public.subjects(id),
    title text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists idx_chat_sessions_student on public.chat_sessions(student_id, updated_at desc);
create index if not exists idx_chat_sessions_agent on public.chat_sessions(student_id, agent_type, updated_at desc);

drop trigger if exists trg_chat_sessions_updated_at on public.chat_sessions;
create trigger trg_chat_sessions_updated_at
    before update on public.chat_sessions
    for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- chat_messages: 消息
-- -----------------------------------------------------------------------------
create table if not exists public.chat_messages (
    id uuid primary key default gen_random_uuid(),
    session_id uuid not null references public.chat_sessions(id) on delete cascade,
    role text not null check (role in ('user', 'assistant', 'system', 'tool')),
    content text not null,
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);

create index if not exists idx_chat_messages_session on public.chat_messages(session_id, created_at asc);

-- -----------------------------------------------------------------------------
-- RLS 策略
-- 学生只能读写自己的 profile / session / message
-- subjects 对所有已登录用户可读
-- service_role 自动绕过 RLS (后端使用)
-- -----------------------------------------------------------------------------
alter table public.student_profiles enable row level security;
alter table public.chat_sessions enable row level security;
alter table public.chat_messages enable row level security;
alter table public.subjects enable row level security;

-- student_profiles
drop policy if exists "student can read own profile" on public.student_profiles;
create policy "student can read own profile" on public.student_profiles
    for select using (auth.uid() = user_id);

drop policy if exists "student can insert own profile" on public.student_profiles;
create policy "student can insert own profile" on public.student_profiles
    for insert with check (auth.uid() = user_id);

drop policy if exists "student can update own profile" on public.student_profiles;
create policy "student can update own profile" on public.student_profiles
    for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- subjects: 所有登录用户都能读
drop policy if exists "subjects readable by authenticated" on public.subjects;
create policy "subjects readable by authenticated" on public.subjects
    for select using (auth.role() = 'authenticated');

-- chat_sessions
drop policy if exists "student can crud own sessions" on public.chat_sessions;
create policy "student can crud own sessions" on public.chat_sessions
    for all using (auth.uid() = student_id) with check (auth.uid() = student_id);

-- chat_messages: 通过 session 间接判断归属
drop policy if exists "student can read messages of own sessions" on public.chat_messages;
create policy "student can read messages of own sessions" on public.chat_messages
    for select using (
        exists (
            select 1 from public.chat_sessions s
            where s.id = chat_messages.session_id and s.student_id = auth.uid()
        )
    );

drop policy if exists "student can insert messages of own sessions" on public.chat_messages;
create policy "student can insert messages of own sessions" on public.chat_messages
    for insert with check (
        exists (
            select 1 from public.chat_sessions s
            where s.id = chat_messages.session_id and s.student_id = auth.uid()
        )
    );

-- -----------------------------------------------------------------------------
-- 注册新用户后自动创建 student_profiles 行
-- -----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into public.student_profiles (user_id, name)
    values (
        new.id,
        coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1))
    )
    on conflict (user_id) do nothing;
    return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();
