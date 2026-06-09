-- =============================================================================
-- 学生学习驾驶舱 - Phase 1 资料上传 + RAG migration
-- 在 Supabase SQL Editor 中执行此文件即可创建 Phase 1 所需的表/索引/RLS/Storage
-- =============================================================================

-- -----------------------------------------------------------------------------
-- learning_materials: 学习资料元信息
-- -----------------------------------------------------------------------------
create table if not exists public.learning_materials (
    id uuid primary key default gen_random_uuid(),
    -- platform: 平台公共资料(后续 Phase 上 admin 用), student: 学生个人上传
    owner_type text not null default 'student' check (owner_type in ('platform', 'student')),
    -- owner_type=student 时指向 auth.users.id; platform 时为 null
    owner_id uuid references auth.users(id) on delete cascade,
    title text not null,
    subject_id text references public.subjects(id),
    grade text,
    material_type text not null default 'note'
        check (material_type in ('textbook', 'handout', 'homework', 'exam', 'note', 'wrong_question', 'other')),
    -- Supabase Storage 中的对象路径 (bucket: materials, key: <owner_id>/<material_id>.<ext>)
    storage_path text not null,
    -- 原始文件名,展示用
    original_filename text not null,
    mime_type text not null,
    size_bytes bigint not null,
    -- 解析与切片状态
    parse_status text not null default 'pending'
        check (parse_status in ('pending', 'processing', 'ready', 'failed')),
    parse_error text,
    -- 全文与摘要,parsed 后填充
    parsed_text text,
    summary text,
    chunk_count int not null default 0,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    -- platform 资料 owner_id 为 null; student 资料 owner_id 必填
    constraint chk_owner check (
        (owner_type = 'platform' and owner_id is null) or
        (owner_type = 'student' and owner_id is not null)
    )
);

comment on table public.learning_materials is '学习资料 (学生上传 + 平台公共)';
create index if not exists idx_materials_owner on public.learning_materials(owner_id, created_at desc);
create index if not exists idx_materials_subject on public.learning_materials(subject_id);

drop trigger if exists trg_materials_updated_at on public.learning_materials;
create trigger trg_materials_updated_at
    before update on public.learning_materials
    for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- material_chunks: 切片与 embedding
-- text-embedding-3-small 输出 1536 维
-- -----------------------------------------------------------------------------
create table if not exists public.material_chunks (
    id uuid primary key default gen_random_uuid(),
    material_id uuid not null references public.learning_materials(id) on delete cascade,
    chunk_index int not null,
    content text not null,
    -- 拆字符数,便于检索 UI 展示
    char_count int not null,
    token_count int,
    embedding vector(1536),
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    unique (material_id, chunk_index)
);

comment on table public.material_chunks is '资料切片 + pgvector embedding';
create index if not exists idx_chunks_material on public.material_chunks(material_id, chunk_index);

-- pgvector HNSW 索引: pgvector >= 0.5.0 支持,无需训练数据,适合小到中等量级数据
-- 用 cosine 距离,与 OpenAI 推荐保持一致
do $$
begin
    if not exists (
        select 1 from pg_indexes
        where schemaname = 'public' and indexname = 'idx_chunks_embedding_hnsw'
    ) then
        execute 'create index idx_chunks_embedding_hnsw on public.material_chunks using hnsw (embedding vector_cosine_ops)';
    end if;
exception
    when others then
        -- 兼容老版本 pgvector 没有 HNSW:跳过,后续可手动建 ivfflat 索引
        raise notice 'HNSW 索引创建失败 (pgvector 版本过低?),已跳过: %', sqlerrm;
end $$;

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.learning_materials enable row level security;
alter table public.material_chunks enable row level security;

-- learning_materials
drop policy if exists "materials: read own + platform" on public.learning_materials;
create policy "materials: read own + platform" on public.learning_materials
    for select using (
        owner_type = 'platform' or owner_id = auth.uid()
    );

drop policy if exists "materials: insert own" on public.learning_materials;
create policy "materials: insert own" on public.learning_materials
    for insert with check (owner_type = 'student' and owner_id = auth.uid());

drop policy if exists "materials: update own" on public.learning_materials;
create policy "materials: update own" on public.learning_materials
    for update using (owner_type = 'student' and owner_id = auth.uid())
    with check (owner_type = 'student' and owner_id = auth.uid());

drop policy if exists "materials: delete own" on public.learning_materials;
create policy "materials: delete own" on public.learning_materials
    for delete using (owner_type = 'student' and owner_id = auth.uid());

-- material_chunks: 通过 material 间接判断
drop policy if exists "chunks: read if material visible" on public.material_chunks;
create policy "chunks: read if material visible" on public.material_chunks
    for select using (
        exists (
            select 1 from public.learning_materials m
            where m.id = material_chunks.material_id
              and (m.owner_type = 'platform' or m.owner_id = auth.uid())
        )
    );

-- chunk 的插入/更新/删除都通过 service_role 在后端处理,无需为 anon/authenticated 配置

-- -----------------------------------------------------------------------------
-- Storage bucket: materials
-- - private (非公开)
-- - 学生只能在以自己 user_id 命名的子目录下增/删/读
-- - 后端用 service_role 仍可读写任意路径,无需特别配置
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('materials', 'materials', false)
on conflict (id) do nothing;

drop policy if exists "materials bucket: students read own folder" on storage.objects;
create policy "materials bucket: students read own folder"
    on storage.objects for select
    using (
        bucket_id = 'materials'
        and (storage.foldername(name))[1] = auth.uid()::text
    );

drop policy if exists "materials bucket: students upload own folder" on storage.objects;
create policy "materials bucket: students upload own folder"
    on storage.objects for insert
    with check (
        bucket_id = 'materials'
        and (storage.foldername(name))[1] = auth.uid()::text
    );

drop policy if exists "materials bucket: students delete own folder" on storage.objects;
create policy "materials bucket: students delete own folder"
    on storage.objects for delete
    using (
        bucket_id = 'materials'
        and (storage.foldername(name))[1] = auth.uid()::text
    );

-- -----------------------------------------------------------------------------
-- 向量检索 RPC: 按 owner_id + material_ids 过滤后的 top-k cosine 检索
-- 供后端 supabase-py 调用: client.rpc('match_material_chunks', { ... })
-- - 入参用 vector(1536),前端/后端均传 list[float]
-- - similarity = 1 - (embedding <=> query)  ∈ [-1, 1],越大越相似
-- -----------------------------------------------------------------------------
create or replace function public.match_material_chunks(
    query_embedding vector(1536),
    match_count int default 5,
    p_owner_id uuid default null,
    p_material_ids uuid[] default null
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
      and (p_owner_id is null or m.owner_id = p_owner_id or m.owner_type = 'platform')
      and (p_material_ids is null or m.id = any(p_material_ids))
    order by c.embedding <=> query_embedding
    limit greatest(coalesce(match_count, 5), 1)
$$;

comment on function public.match_material_chunks is 'pgvector top-k 检索,后端 RAG 召回入口';

-- -----------------------------------------------------------------------------
-- chat_messages.metadata 用法约定
-- 在 assistant 消息上,metadata 可以是:
-- {
--   "agent_type": "math_teacher",
--   "model": "gpt-4o-mini",
--   "citations": [
--     { "material_id": "...", "title": "...", "chunk_index": 3 }
--   ]
-- }
-- 不改 schema,这里只是文档化。
-- -----------------------------------------------------------------------------
