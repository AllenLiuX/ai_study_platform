-- =============================================================================
-- 学生学习驾驶舱 - Phase 3 今日推荐任务 migration
-- - student_daily_tasks: 学生 × 日期 唯一的任务清单缓存
-- - tasks jsonb 数组,每个 task 形如:
--     {
--       "id": "<uuid>",
--       "title": "...",
--       "description": "...",
--       "subject_label": "数学",
--       "agent_type": "math_teacher",
--       "estimated_minutes": 15,
--       "tag": "薄弱 | 复习 | 新学 | 规划",
--       "starter_prompt": "...",
--       "knowledge_point_ids": ["math-quadratic-vertex", ...]
--     }
-- =============================================================================

create table if not exists public.student_daily_tasks (
    id uuid primary key default gen_random_uuid(),
    student_id uuid not null references auth.users(id) on delete cascade,
    task_date date not null,
    tasks jsonb not null default '[]'::jsonb,
    context jsonb,                  -- 生成时的输入快照,debug 用
    model text,                     -- 生成所使用的 LLM
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (student_id, task_date)
);

comment on table public.student_daily_tasks is '学生今日推荐任务缓存 (每天一行,LLM 生成)';

create index if not exists idx_sdt_student_date
    on public.student_daily_tasks(student_id, task_date desc);

drop trigger if exists trg_sdt_updated_at on public.student_daily_tasks;
create trigger trg_sdt_updated_at
    before update on public.student_daily_tasks
    for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS:学生只能读自己的任务清单;写入仅 service_role 可执行 (后端用 admin client)
-- ---------------------------------------------------------------------------
alter table public.student_daily_tasks enable row level security;

drop policy if exists "daily tasks: read own" on public.student_daily_tasks;
create policy "daily tasks: read own"
    on public.student_daily_tasks
    for select
    using (student_id = auth.uid());

-- 显式拒绝 anon / authenticated 直写;留给 service_role bypass。
drop policy if exists "daily tasks: no write client" on public.student_daily_tasks;
create policy "daily tasks: no write client"
    on public.student_daily_tasks
    for all
    using (false)
    with check (false);
