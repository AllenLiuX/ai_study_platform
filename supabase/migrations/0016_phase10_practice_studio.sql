-- =============================================================================
-- Phase 10 · 练习工坊 (Practice Studio)
--
-- 用户用自然语言描述想要的练习, 后端 LLM 生成一份"练习规格"(JSON spec);
-- 前端用内置练习块 (选择/填空/配对/排序/闪卡/简答/嵌入训练组件) 渲染;
-- 当需求超出内置块时, LLM 降级为 sandbox 模式, 直接给一段自包含 HTML,
-- 前端放到隔离 iframe 里运行。
--
-- 生成结果保存下来, 可复用 / 改名 / 收藏 / 删除。
-- 后端所有接口走 service_role 绕过 RLS, 在 Python 里做 owner 校验。
-- =============================================================================

create table if not exists public.practice_specs (
    id                 uuid primary key default gen_random_uuid(),
    owner_id           uuid not null references auth.users(id) on delete cascade,
    title              text not null check (char_length(title) between 1 and 200),
    domain             text,
    description        text,
    prompt             text,                       -- 用户原始描述
    mode               text not null default 'structured'
                            check (mode in ('structured', 'sandbox')),
    spec               jsonb not null,             -- 完整练习规格
    generated_by_model text,
    times_used         int not null default 0,
    last_used_at       timestamptz,
    is_favorite        boolean not null default false,
    created_at         timestamptz not null default now(),
    updated_at         timestamptz not null default now()
);

create index if not exists idx_practice_specs_owner
    on public.practice_specs (owner_id, created_at desc);

drop trigger if exists trg_practice_specs_updated on public.practice_specs;
create trigger trg_practice_specs_updated
    before update on public.practice_specs
    for each row execute function public.set_updated_at();

alter table public.practice_specs enable row level security;

drop policy if exists practice_specs_self_read on public.practice_specs;
create policy practice_specs_self_read on public.practice_specs
    for select using (owner_id = auth.uid());
-- 无 insert / update / delete 策略 → 只有 service_role (bypass RLS) 能写。
