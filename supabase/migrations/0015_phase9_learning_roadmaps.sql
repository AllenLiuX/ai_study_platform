-- =============================================================================
-- Phase 9 — 动态学习规划 / 科技树
-- MVP 将动态学习线和节点整体存为 JSONB，允许不同领域拥有不同数量的学习线。
-- 后续若需要跨用户统计节点，可在保持 API 不变的前提下拆分为 lanes / nodes / edges 表。
-- =============================================================================

create table if not exists public.learning_roadmaps (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null references auth.users(id) on delete cascade,
    title text not null,
    goal text not null,
    baseline text,
    target_date date,
    weekly_hours int not null default 8 check (weekly_hours between 1 and 80),
    agent_key text references public.user_agents(agent_key) on delete set null,
    status text not null default 'active'
        check (status in ('draft', 'active', 'completed', 'archived')),
    -- [{ id, title, purpose, nodes: [{ id, title, status, ... }] }]
    lanes jsonb not null default '[]'::jsonb
        check (jsonb_typeof(lanes) = 'array'),
    version int not null default 1,
    generated_by_model text,
    generation_context jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

comment on table public.learning_roadmaps is
    '用户动态学习规划；lanes 数量和每条线的节点均由目标与基线动态决定';

create index if not exists idx_learning_roadmaps_owner
    on public.learning_roadmaps(owner_id, updated_at desc);
create index if not exists idx_learning_roadmaps_active
    on public.learning_roadmaps(owner_id, status)
    where status = 'active';

drop trigger if exists trg_learning_roadmaps_updated_at on public.learning_roadmaps;
create trigger trg_learning_roadmaps_updated_at
    before update on public.learning_roadmaps
    for each row execute function public.set_updated_at();

alter table public.learning_roadmaps enable row level security;

drop policy if exists "roadmaps: read own" on public.learning_roadmaps;
create policy "roadmaps: read own" on public.learning_roadmaps
    for select using (owner_id = auth.uid());

drop policy if exists "roadmaps: insert own" on public.learning_roadmaps;
create policy "roadmaps: insert own" on public.learning_roadmaps
    for insert with check (owner_id = auth.uid());

drop policy if exists "roadmaps: update own" on public.learning_roadmaps;
create policy "roadmaps: update own" on public.learning_roadmaps
    for update using (owner_id = auth.uid())
    with check (owner_id = auth.uid());

drop policy if exists "roadmaps: delete own" on public.learning_roadmaps;
create policy "roadmaps: delete own" on public.learning_roadmaps
    for delete using (owner_id = auth.uid());
