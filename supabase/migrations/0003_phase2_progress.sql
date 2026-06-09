-- =============================================================================
-- 学生学习驾驶舱 - Phase 2 学习进度沉淀 migration
-- 在 Supabase SQL Editor 中执行此文件即可创建 Phase 2 所需的表/索引/RLS
-- =============================================================================

-- -----------------------------------------------------------------------------
-- knowledge_points: 知识点树 (公共,所有学生共享)
-- - id 用 text:与 seed-data/curriculum 里的 topic id 一致 (如 "math-circle")
-- - parent_id 实现树状结构,根节点 parent_id = null
-- - level 冗余存深度便于查询
-- -----------------------------------------------------------------------------
create table if not exists public.knowledge_points (
    id text primary key,
    subject_id text references public.subjects(id),
    parent_id text references public.knowledge_points(id) on delete set null,
    name text not null,
    description text,
    stage text,                       -- 初中 / 高中
    grade text,                       -- 七年级 / 八年级 / ...
    sort_order int not null default 0,
    level int not null default 0,     -- 树深度,根为 0
    is_leaf boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

comment on table public.knowledge_points is '知识点树 (公共,与学生数据无关)';
create index if not exists idx_kp_subject on public.knowledge_points(subject_id, level);
create index if not exists idx_kp_parent on public.knowledge_points(parent_id);

drop trigger if exists trg_kp_updated_at on public.knowledge_points;
create trigger trg_kp_updated_at
    before update on public.knowledge_points
    for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- student_progress: 学生 × 知识点的掌握度
-- - mastery: 0-100,初始 50;LLM 抽取后做加权更新
-- - encounter_count / recent_error_count 记录交互痕迹
-- - last_evaluation: 最近一次 LLM 评估的原始数据 (debug)
-- -----------------------------------------------------------------------------
create table if not exists public.student_progress (
    id uuid primary key default gen_random_uuid(),
    student_id uuid not null references auth.users(id) on delete cascade,
    knowledge_point_id text not null references public.knowledge_points(id) on delete cascade,
    mastery int not null default 50 check (mastery between 0 and 100),
    -- 加权方差类指标:近 N 次评估的离散度,可后续用于"复习紧迫度"
    confidence float not null default 0.5 check (confidence between 0 and 1),
    encounter_count int not null default 0,
    recent_error_count int not null default 0,
    last_encountered_at timestamptz,
    last_evaluation_at timestamptz,
    last_evaluation jsonb,
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (student_id, knowledge_point_id)
);

comment on table public.student_progress is '学生 × 知识点的掌握度,Phase 2 主表';
create index if not exists idx_progress_student on public.student_progress(student_id, mastery);
create index if not exists idx_progress_student_kp on public.student_progress(student_id, knowledge_point_id);

drop trigger if exists trg_progress_updated_at on public.student_progress;
create trigger trg_progress_updated_at
    before update on public.student_progress
    for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.knowledge_points enable row level security;
alter table public.student_progress enable row level security;

-- knowledge_points:所有 authenticated 用户都能读
drop policy if exists "kp: read for authenticated" on public.knowledge_points;
create policy "kp: read for authenticated" on public.knowledge_points
    for select using (auth.role() = 'authenticated');
-- 写入只走 service_role (不为 anon/authenticated 配置 insert/update/delete 政策)

-- student_progress:学生只能看自己的
drop policy if exists "progress: read own" on public.student_progress;
create policy "progress: read own" on public.student_progress
    for select using (student_id = auth.uid());

drop policy if exists "progress: insert own" on public.student_progress;
create policy "progress: insert own" on public.student_progress
    for insert with check (student_id = auth.uid());

drop policy if exists "progress: update own" on public.student_progress;
create policy "progress: update own" on public.student_progress
    for update using (student_id = auth.uid())
    with check (student_id = auth.uid());

-- -----------------------------------------------------------------------------
-- 视图 / 函数: 学科级聚合
-- 后端用 service_role 调用 RPC 拿一个学科的 mastery / weak points
-- -----------------------------------------------------------------------------
create or replace function public.summarize_student_progress(
    p_student_id uuid
)
returns table (
    subject_id text,
    avg_mastery float,
    covered_count int,
    weak_count int      -- mastery < 60 的知识点数量
)
language sql
stable
as $$
    select
        kp.subject_id,
        coalesce(avg(sp.mastery)::float, 50.0) as avg_mastery,
        count(sp.id)::int as covered_count,
        count(sp.id) filter (where sp.mastery < 60)::int as weak_count
    from public.knowledge_points kp
    left join public.student_progress sp
      on sp.knowledge_point_id = kp.id and sp.student_id = p_student_id
    where kp.subject_id is not null
    group by kp.subject_id
$$;

comment on function public.summarize_student_progress is 'Phase 2: 各学科 mastery 汇总';

-- 取某学科薄弱点 top-N (mastery 升序;若无记录则按 sort_order)
create or replace function public.list_weak_points(
    p_student_id uuid,
    p_subject_id text,
    p_limit int default 3
)
returns table (
    knowledge_point_id text,
    name text,
    parent_name text,
    mastery int,
    encounter_count int
)
language sql
stable
as $$
    select
        kp.id as knowledge_point_id,
        kp.name,
        parent.name as parent_name,
        coalesce(sp.mastery, 50) as mastery,
        coalesce(sp.encounter_count, 0) as encounter_count
    from public.knowledge_points kp
    left join public.student_progress sp
      on sp.knowledge_point_id = kp.id and sp.student_id = p_student_id
    left join public.knowledge_points parent on parent.id = kp.parent_id
    where kp.subject_id = p_subject_id and kp.is_leaf = true
    order by
        -- 已有记录的优先按 mastery 升序 + encounter_count 降序
        case when sp.id is null then 1 else 0 end,
        coalesce(sp.mastery, 50) asc,
        coalesce(sp.encounter_count, 0) desc,
        kp.sort_order asc
    limit greatest(coalesce(p_limit, 3), 1)
$$;

comment on function public.list_weak_points is 'Phase 2: 某学科薄弱点 top-N';

-- 取学生最近接触的章节 (作为 "当前章节" 展示)
create or replace function public.recent_chapter(
    p_student_id uuid,
    p_subject_id text
)
returns table (
    chapter_id text,
    chapter_name text,
    last_encountered_at timestamptz,
    leaf_count int
)
language sql
stable
as $$
    with recent_leaves as (
        select
            kp.parent_id,
            sp.last_encountered_at
        from public.student_progress sp
        join public.knowledge_points kp on kp.id = sp.knowledge_point_id
        where sp.student_id = p_student_id
          and kp.subject_id = p_subject_id
          and kp.is_leaf = true
          and sp.last_encountered_at is not null
        order by sp.last_encountered_at desc
        limit 30
    )
    select
        parent.id as chapter_id,
        parent.name as chapter_name,
        max(rl.last_encountered_at) as last_encountered_at,
        count(*)::int as leaf_count
    from recent_leaves rl
    join public.knowledge_points parent on parent.id = rl.parent_id
    group by parent.id, parent.name
    order by last_encountered_at desc nulls last
    limit 1
$$;

comment on function public.recent_chapter is 'Phase 2: 学生在某学科最近接触最多的章节';
