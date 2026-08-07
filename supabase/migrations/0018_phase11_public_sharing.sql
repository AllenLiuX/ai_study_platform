-- =============================================================================
-- Phase 11 · 公开分享
--
-- 用户自建的「老师」(user_agents) 和「训练器」(practice_specs) 可设为 public,
-- 出现在「发现」页供其他用户浏览并使用：
--   - 老师：他人「添加到我的老师」= 克隆一份到自己名下 (owner 归属 + 可自行改)
--   - 训练器：他人可直接运行 public spec，也可「收藏到工坊」= 克隆一份
--
-- cloned_from 记录来源，用于去重(同一用户对同一来源只克隆一次) + 溯源。
-- clone_count 记录被克隆次数，用于发现页热度排序。
-- 后端所有写操作走 service_role (bypass RLS)，Python 里做归属/可见性校验；
-- 这里额外补一条 public 只读 RLS 策略作为防御纵深。
-- =============================================================================

-- ---- 老师 ----------------------------------------------------------------
alter table public.user_agents
    add column if not exists is_public   boolean not null default false,
    add column if not exists cloned_from uuid references public.user_agents(id) on delete set null,
    add column if not exists clone_count int not null default 0;

create index if not exists idx_user_agents_public
    on public.user_agents (is_public, updated_at desc)
    where is_public and is_active;

drop policy if exists "agents: read public" on public.user_agents;
create policy "agents: read public" on public.user_agents
    for select using (is_public and is_active);

-- ---- 训练器 --------------------------------------------------------------
alter table public.practice_specs
    add column if not exists is_public   boolean not null default false,
    add column if not exists cloned_from uuid references public.practice_specs(id) on delete set null,
    add column if not exists clone_count int not null default 0;

create index if not exists idx_practice_specs_public
    on public.practice_specs (is_public, times_used desc)
    where is_public;

drop policy if exists practice_specs_public_read on public.practice_specs;
create policy practice_specs_public_read on public.practice_specs
    for select using (is_public);
