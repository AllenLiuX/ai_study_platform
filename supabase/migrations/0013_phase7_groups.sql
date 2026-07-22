-- =============================================================================
-- Phase 7 — 群组/班级 (共享资料库 + 笔记)
--
-- 场景: 学校每个班级 / 学习小组 / 兴趣圈子;成员共享 学习资料 和 笔记。
--
-- 设计要点:
--   - hybrid discovery: is_public=true 可被搜, false 只能靠 invite_code 加入
--   - group_only 归属: 资料/笔记 group_id 有值 → 只属于群 (不在个人库)
--   - 三级角色: owner > admin > member
--       * 所有成员: 可读、可上传/新建、可删自己创建的
--       * admin/owner: 额外可删任何成员创建的、可踢人 (踢人 UI 之后再说)
--       * owner: 唯一可删群
-- =============================================================================


-- -----------------------------------------------------------------------------
-- groups: 群组元信息
-- -----------------------------------------------------------------------------
create table if not exists public.groups (
    id uuid primary key default gen_random_uuid(),
    name text not null check (char_length(name) between 1 and 60),
    description text,
    -- 6-8 位大小写字母数字随机码, 全局唯一, 用于私密群加入
    invite_code text not null unique,
    -- true = 可被 /groups/search 搜到; false = 只能靠 invite_code 加入
    is_public boolean not null default false,
    owner_id uuid not null references auth.users(id) on delete cascade,
    -- 冗余计数, group_members trigger 维护, 便于列表排序 / 展示
    member_count int not null default 1,
    -- 群头像 emoji (可选, 类似班徽)
    emoji text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

comment on table public.groups is '群组/班级: 成员共享学习资料 + 笔记';
create index if not exists idx_groups_owner on public.groups(owner_id);
create index if not exists idx_groups_public on public.groups(is_public, created_at desc)
    where is_public = true;
create index if not exists idx_groups_name_lower on public.groups(lower(name));

drop trigger if exists trg_groups_updated_at on public.groups;
create trigger trg_groups_updated_at
    before update on public.groups
    for each row execute function public.set_updated_at();


-- -----------------------------------------------------------------------------
-- group_members: 成员关系 (多对多)
-- -----------------------------------------------------------------------------
create table if not exists public.group_members (
    group_id uuid not null references public.groups(id) on delete cascade,
    user_id uuid not null references auth.users(id) on delete cascade,
    role text not null default 'member' check (role in ('owner', 'admin', 'member')),
    joined_at timestamptz not null default now(),
    primary key (group_id, user_id)
);

comment on table public.group_members is '群组成员 (role: owner|admin|member)';
create index if not exists idx_group_members_user on public.group_members(user_id, joined_at desc);
create index if not exists idx_group_members_group on public.group_members(group_id, role);


-- -----------------------------------------------------------------------------
-- Trigger: 自动维护 groups.member_count
-- -----------------------------------------------------------------------------
create or replace function public.sync_group_member_count()
returns trigger language plpgsql as $$
begin
    if tg_op = 'INSERT' then
        update public.groups
           set member_count = member_count + 1
         where id = new.group_id;
        return new;
    elsif tg_op = 'DELETE' then
        update public.groups
           set member_count = greatest(member_count - 1, 0)
         where id = old.group_id;
        return old;
    end if;
    return null;
end;
$$;

drop trigger if exists trg_group_members_count on public.group_members;
create trigger trg_group_members_count
    after insert or delete on public.group_members
    for each row execute function public.sync_group_member_count();


-- -----------------------------------------------------------------------------
-- 给 learning_materials + knowledge_notes 加 group_id (nullable)
--   null = 个人内容; 有值 = 群组共享内容
-- -----------------------------------------------------------------------------
alter table public.learning_materials
    add column if not exists group_id uuid references public.groups(id) on delete cascade;
create index if not exists idx_materials_group on public.learning_materials(group_id, created_at desc)
    where group_id is not null;

alter table public.knowledge_notes
    add column if not exists group_id uuid references public.groups(id) on delete cascade;
create index if not exists idx_notes_group on public.knowledge_notes(group_id, created_at desc)
    where group_id is not null;


-- -----------------------------------------------------------------------------
-- RLS: groups / group_members
-- 备注: 后端所有接口都走 service_role 绕过 RLS + 在 Python 里做权限;
--       这里的 RLS 主要是防"用户 anon key 直连 Supabase" 的兜底.
-- -----------------------------------------------------------------------------
alter table public.groups enable row level security;
alter table public.group_members enable row level security;

-- groups: 成员可读; 公开群大家都能读 (用于搜索)
drop policy if exists "groups: read member or public" on public.groups;
create policy "groups: read member or public" on public.groups
    for select using (
        is_public = true
        or owner_id = auth.uid()
        or exists (
            select 1 from public.group_members m
             where m.group_id = groups.id and m.user_id = auth.uid()
        )
    );

drop policy if exists "groups: owner update" on public.groups;
create policy "groups: owner update" on public.groups
    for update using (owner_id = auth.uid())
    with check (owner_id = auth.uid());

drop policy if exists "groups: owner delete" on public.groups;
create policy "groups: owner delete" on public.groups
    for delete using (owner_id = auth.uid());
-- insert 只走 service_role (自动挂 owner_id + 首个 member 记录),故不加 policy

-- group_members: 自己是成员 → 可读群里所有成员
drop policy if exists "group_members: read if member" on public.group_members;
create policy "group_members: read if member" on public.group_members
    for select using (
        exists (
            select 1 from public.group_members m2
             where m2.group_id = group_members.group_id and m2.user_id = auth.uid()
        )
    );
-- insert/delete 均走 service_role (加群 / 退群 / 踢人)


-- -----------------------------------------------------------------------------
-- 更新 learning_materials + knowledge_notes RLS: 增加"我是群成员"分支
-- -----------------------------------------------------------------------------
-- learning_materials
drop policy if exists "materials: read own + platform" on public.learning_materials;
create policy "materials: read own + platform + group_member" on public.learning_materials
    for select using (
        owner_type = 'platform'
        or owner_id = auth.uid()
        or (
            group_id is not null and exists (
                select 1 from public.group_members m
                 where m.group_id = learning_materials.group_id and m.user_id = auth.uid()
            )
        )
    );
-- insert/update/delete 保持原策略 (owner_id = auth.uid()), 群内 CRUD 由后端 service_role 做

-- knowledge_notes
drop policy if exists "notes: read own" on public.knowledge_notes;
create policy "notes: read own + group_member" on public.knowledge_notes
    for select using (
        owner_id = auth.uid()
        or (
            group_id is not null and exists (
                select 1 from public.group_members m
                 where m.group_id = knowledge_notes.group_id and m.user_id = auth.uid()
            )
        )
    );


-- -----------------------------------------------------------------------------
-- 更新 match_material_chunks / match_knowledge_notes RPC: 加 group_id 过滤参数
-- 允许 RAG 命中"我加入的所有群"里的资料/笔记
-- -----------------------------------------------------------------------------
create or replace function public.match_material_chunks(
    query_embedding vector(1536),
    match_count int default 5,
    p_owner_id uuid default null,
    p_material_ids uuid[] default null,
    p_group_ids uuid[] default null
)
returns table (
    chunk_id uuid,
    material_id uuid,
    chunk_index int,
    content text,
    similarity float,
    material_title text,
    material_subject text
)
language sql
stable
as $$
    select
        c.id as chunk_id,
        c.material_id,
        c.chunk_index,
        c.content,
        1 - (c.embedding <=> query_embedding) as similarity,
        m.title as material_title,
        m.subject_id as material_subject
    from public.material_chunks c
    join public.learning_materials m on m.id = c.material_id
    where c.embedding is not null
      and (
          p_owner_id is null
          or m.owner_id = p_owner_id
          or m.owner_type = 'platform'
          or (p_group_ids is not null and m.group_id = any(p_group_ids))
      )
      and (p_material_ids is null or m.id = any(p_material_ids))
    order by c.embedding <=> query_embedding
    limit greatest(coalesce(match_count, 5), 1)
$$;

create or replace function public.match_knowledge_notes(
    query_embedding vector(1536),
    match_count int default 5,
    p_owner_id uuid default null,
    p_note_ids uuid[] default null,
    p_group_ids uuid[] default null
)
returns table (
    chunk_id uuid,
    note_id uuid,
    chunk_index int,
    content text,
    similarity float,
    note_title text,
    note_tags jsonb
)
language sql
stable
as $$
    select
        c.id as chunk_id,
        c.note_id,
        c.chunk_index,
        c.content,
        1 - (c.embedding <=> query_embedding) as similarity,
        n.title as note_title,
        n.tags as note_tags
    from public.knowledge_note_chunks c
    join public.knowledge_notes n on n.id = c.note_id
    where
        (
            p_owner_id is null
            or n.owner_id = p_owner_id
            or (p_group_ids is not null and n.group_id = any(p_group_ids))
        )
        and (p_note_ids is null or n.id = any(p_note_ids))
    order by c.embedding <=> query_embedding
    limit match_count;
$$;
