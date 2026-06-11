-- =============================================================================
-- Phase 6 — 练习模块 (Practice)
-- 三张表:
--   practice_sessions  一次练习
--   practice_questions 单道题 (LLM 出 / 静态)
--   practice_attempts  用户作答 + 评分
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. practice_sessions
-- -----------------------------------------------------------------------------
create table if not exists public.practice_sessions (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null references auth.users(id) on delete cascade,
    -- 出题老师:user_agents.agent_key (含 4 个平台老师 + 用户自定义老师)
    agent_key text not null,
    -- 学生定的练习主题 / 知识点
    topic text not null,
    -- 老师建议的学习计划 / 出题方向 (LLM 生成,可选)
    plan text,
    -- 配置
    target_minutes int not null default 30 check (target_minutes between 5 and 240),
    target_question_count int not null default 10 check (target_question_count between 1 and 100),
    -- 启用的题型 (subset of ['mcq','multi_mcq','fill','short'])
    allowed_kinds text[] not null default array['mcq','fill','short']::text[],
    -- 难度策略:fixed_1..fixed_5 / adaptive
    difficulty_strategy text not null default 'adaptive'
        check (difficulty_strategy in ('adaptive','fixed_1','fixed_2','fixed_3','fixed_4','fixed_5')),
    -- 默认模型档位
    model_tier text not null default 'medium',
    -- 状态:active / finished / abandoned
    status text not null default 'active' check (status in ('active','finished','abandoned')),
    -- 总结 (finish 时填,jsonb 灵活演进)
    summary jsonb,
    started_at timestamptz not null default now(),
    finished_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists idx_practice_sessions_owner
    on public.practice_sessions(owner_id, started_at desc);
create index if not exists idx_practice_sessions_agent
    on public.practice_sessions(owner_id, agent_key, started_at desc);

drop trigger if exists trg_practice_sessions_updated_at on public.practice_sessions;
create trigger trg_practice_sessions_updated_at
    before update on public.practice_sessions
    for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 2. practice_questions
-- -----------------------------------------------------------------------------
create table if not exists public.practice_questions (
    id uuid primary key default gen_random_uuid(),
    session_id uuid not null references public.practice_sessions(id) on delete cascade,
    -- 在 session 内的序号 (1-based,出题时递增)
    idx int not null,
    kind text not null check (kind in ('mcq','multi_mcq','fill','short')),
    -- 题干 markdown (可含 LaTeX)
    prompt text not null,
    -- 选项 (mcq/multi_mcq 时是 [{id:'A',text:'...'}, ...];fill/short 时为 null)
    options jsonb,
    -- 标准答案:
    --   mcq:        "A"
    --   multi_mcq:  ["A","C"]
    --   fill:       ["LRU","Least Recently Used"]  允许多种等价
    --   short:      {rubric: "...要点 1/2/3...", reference: "..."}
    answer jsonb not null,
    -- 解析 (markdown)
    explanation text,
    -- 难度 1..5
    difficulty int not null default 3 check (difficulty between 1 and 5),
    -- 知识点 tags (用于掌握度统计)
    knowledge_points text[] not null default '{}',
    -- 出题来源:agent / from_material / from_note / manual
    source text not null default 'agent',
    -- 出题时让 LLM 顺便给的提示链 (3-5 条 hint,渐进式)
    hints jsonb not null default '[]'::jsonb,
    created_at timestamptz not null default now(),
    unique (session_id, idx)
);

create index if not exists idx_practice_questions_session
    on public.practice_questions(session_id, idx);

-- -----------------------------------------------------------------------------
-- 3. practice_attempts
-- -----------------------------------------------------------------------------
create table if not exists public.practice_attempts (
    id uuid primary key default gen_random_uuid(),
    question_id uuid not null references public.practice_questions(id) on delete cascade,
    -- 学生给的答案 (jsonb 灵活承载不同题型)
    user_answer jsonb,
    -- 是否正确:
    --   mcq / multi_mcq / fill:   true / false
    --   short:                    null (LLM 评 score)
    --   skipped:                  null
    is_correct boolean,
    -- short 题的 LLM 评分 (0-10) 与评语
    score numeric(4, 1),
    feedback text,
    -- 是否跳过
    skipped boolean not null default false,
    -- 用时 (ms)
    time_spent_ms int,
    -- 用了几次提示
    hints_used int not null default 0,
    created_at timestamptz not null default now()
);

create index if not exists idx_practice_attempts_question
    on public.practice_attempts(question_id);

-- -----------------------------------------------------------------------------
-- 4. RLS — 用户只能读写自己的练习
-- -----------------------------------------------------------------------------
alter table public.practice_sessions enable row level security;
alter table public.practice_questions enable row level security;
alter table public.practice_attempts enable row level security;

drop policy if exists "practice: own sessions" on public.practice_sessions;
create policy "practice: own sessions" on public.practice_sessions
    for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists "practice: own questions" on public.practice_questions;
create policy "practice: own questions" on public.practice_questions
    for all using (
        exists (
            select 1 from public.practice_sessions s
            where s.id = practice_questions.session_id and s.owner_id = auth.uid()
        )
    ) with check (
        exists (
            select 1 from public.practice_sessions s
            where s.id = practice_questions.session_id and s.owner_id = auth.uid()
        )
    );

drop policy if exists "practice: own attempts" on public.practice_attempts;
create policy "practice: own attempts" on public.practice_attempts
    for all using (
        exists (
            select 1
            from public.practice_questions q
            join public.practice_sessions s on s.id = q.session_id
            where q.id = practice_attempts.question_id and s.owner_id = auth.uid()
        )
    ) with check (
        exists (
            select 1
            from public.practice_questions q
            join public.practice_sessions s on s.id = q.session_id
            where q.id = practice_attempts.question_id and s.owner_id = auth.uid()
        )
    );

comment on table public.practice_sessions is 'Phase 6: 一次练习会话 (老师 + 主题 + 时长 + 题型)';
comment on table public.practice_questions is 'Phase 6: 单道题 (LLM 出 / 静态),含答案 + 解析 + 渐进提示';
comment on table public.practice_attempts is 'Phase 6: 学生作答记录 (含 LLM 评分简答)';
