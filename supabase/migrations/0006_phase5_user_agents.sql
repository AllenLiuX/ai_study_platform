-- =============================================================================
-- Phase 5 — AI 自适应学习平台:自定义老师
-- 把 4 个 hardcoded 老师 migrate 到表;用户可创建自己的私有老师。
-- =============================================================================

-- -----------------------------------------------------------------------------
-- user_agents: 老师注册表 (platform 共享 + user 私有)
-- -----------------------------------------------------------------------------
create table if not exists public.user_agents (
    id uuid primary key default gen_random_uuid(),
    -- platform: 4 个内置老师,所有用户可读;user: 私有老师
    owner_type text not null default 'user' check (owner_type in ('platform', 'user')),
    owner_id uuid references auth.users(id) on delete cascade,
    -- 全局唯一 key (chat_sessions.agent_type 引用):
    --   platform: "head_teacher" / "math_teacher" / ...
    --   user:     "u-<short uuid>" 等用户输入或自动生成
    agent_key text not null unique,
    display_name text not null,
    emoji text default '🎓',
    tagline text,                                -- 一句话简介
    role text,                                   -- "讲概念 · 分步推导"
    system_prompt text not null,
    starter_prompts jsonb not null default '[]'::jsonb,
    -- 老师默认绑定的资料 ids (chat 进入时 MaterialPicker 默认勾上)
    default_material_ids uuid[] not null default '{}',
    -- 自由领域 tags (e.g. ["量化交易","系统设计","面试准备"])
    domains jsonb not null default '[]'::jsonb,
    -- 默认模型档位 (low / medium / high / extra_high / max)
    default_model_tier text not null default 'medium',
    -- 兼容:可以选填一个内置 subject_id,班主任为 null
    subject_id text references public.subjects(id),
    is_active boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    -- platform 行 owner_id 为 null;user 行必填
    constraint chk_agent_owner check (
        (owner_type = 'platform' and owner_id is null) or
        (owner_type = 'user' and owner_id is not null)
    )
);

comment on table public.user_agents is '老师注册表 (Phase 5):平台预设 + 用户自定义';
create index if not exists idx_user_agents_owner on public.user_agents(owner_id, created_at desc);
create index if not exists idx_user_agents_active on public.user_agents(is_active);

drop trigger if exists trg_user_agents_updated_at on public.user_agents;
create trigger trg_user_agents_updated_at
    before update on public.user_agents
    for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- RLS:platform 所有人可读;user 只能读写自己的
-- -----------------------------------------------------------------------------
alter table public.user_agents enable row level security;

drop policy if exists "agents: read platform + own" on public.user_agents;
create policy "agents: read platform + own" on public.user_agents
    for select using (
        owner_type = 'platform' or owner_id = auth.uid()
    );

drop policy if exists "agents: insert own" on public.user_agents;
create policy "agents: insert own" on public.user_agents
    for insert with check (
        owner_type = 'user' and owner_id = auth.uid()
    );

drop policy if exists "agents: update own" on public.user_agents;
create policy "agents: update own" on public.user_agents
    for update using (
        owner_type = 'user' and owner_id = auth.uid()
    );

drop policy if exists "agents: delete own" on public.user_agents;
create policy "agents: delete own" on public.user_agents
    for delete using (
        owner_type = 'user' and owner_id = auth.uid()
    );

-- -----------------------------------------------------------------------------
-- 种子:4 个 platform 内置老师 — 与现有 hardcoded registry 完全一致
-- 仅作 metadata 摆设,system_prompt 仍可由 agents/prompts/*.md 文件提供
-- (后端 registry 会优先读这张表的 system_prompt,空时 fallback 到文件)
-- -----------------------------------------------------------------------------
insert into public.user_agents (
    owner_type, owner_id, agent_key, display_name, emoji, tagline, role,
    system_prompt, starter_prompts, default_model_tier, subject_id
) values
('platform', null, 'head_teacher', 'AI 班主任', '🧭',
    '帮你做规划、汇总薄弱点、安排学习节奏',
    '学习规划与全局诊断',
    '', -- 空 = 后端 fallback 到 head_teacher.md
    '["帮我看看这周怎么安排数学和英语","下个月期中考试,帮我做个冲刺计划","最近学习效率有点低,你能帮我分析吗?"]'::jsonb,
    'medium', null),
('platform', null, 'math_teacher', '数学老师', '📐',
    '讲解概念、分步推导、引导独立思考',
    '数学讲解与分步推导',
    '',
    '["一次函数为什么是一条直线?","我不会因式分解,帮我从头讲一下","这道方程应用题怎么列式?"]'::jsonb,
    'medium', 'math'),
('platform', null, 'english_teacher', '英语老师', '✍️',
    '讲语法、改作文、分析阅读、讲单词',
    '英语语法、阅读与作文',
    '',
    '["现在完成时和一般过去时有什么区别?","帮我改一下这段英语作文","这篇阅读为什么选 B?"]'::jsonb,
    'medium', 'english'),
('platform', null, 'chinese_teacher', '语文老师', '📖',
    '阅读理解、文言文、古诗词、作文构思',
    '语文阅读、文言与作文',
    '',
    '["这篇阅读的中心思想是什么?","文言文这句话怎么翻译?","作文怎么开头更好?"]'::jsonb,
    'medium', 'chinese')
on conflict (agent_key) do nothing;
