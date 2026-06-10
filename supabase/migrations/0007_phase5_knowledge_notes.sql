-- =============================================================================
-- Phase 5 — 笔记 = 知识点
-- 用户在 chat 里对话产出可复用的笔记 (markdown 知识点);
-- 笔记自带向量索引,跟 material_chunks 平级进 RAG 召回。
-- =============================================================================

-- -----------------------------------------------------------------------------
-- knowledge_notes: 笔记/私有知识点
-- - parent_id 形成树 (例:System Design > 缓存 > LRU)
-- - mastery_score 复用 student_progress 类似语义,但范围更主观 (用户自评 + AI 评)
-- -----------------------------------------------------------------------------
create table if not exists public.knowledge_notes (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null references auth.users(id) on delete cascade,
    -- 哪个老师上下文里产生 (引用 user_agents.agent_key,弱外键 — 不做约束)
    agent_key text,
    -- 来源对话 (回溯用,可空 — 用户也能直接创建笔记)
    origin_session_id uuid references public.chat_sessions(id) on delete set null,
    origin_message_id uuid,
    title text not null,
    content text not null,             -- markdown 正文 (含公式 / 代码 / 表格)
    summary text,                       -- 1-2 句话浓缩
    tags jsonb not null default '[]'::jsonb,
    parent_id uuid references public.knowledge_notes(id) on delete set null,
    mastery_score int not null default 0 check (mastery_score between 0 and 100),
    review_count int not null default 0,
    last_reviewed_at timestamptz,
    source text not null default 'chat' check (source in ('chat', 'manual', 'imported')),
    -- 切片状态 (后台异步生成 embedding)
    chunk_status text not null default 'pending' check (chunk_status in ('pending', 'processing', 'ready', 'failed')),
    chunk_count int not null default 0,
    chunk_error text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

comment on table public.knowledge_notes is '笔记 = 私有知识点 (Phase 5),可被 RAG 召回';
create index if not exists idx_notes_owner on public.knowledge_notes(owner_id, created_at desc);
create index if not exists idx_notes_parent on public.knowledge_notes(parent_id);
create index if not exists idx_notes_agent on public.knowledge_notes(owner_id, agent_key);
-- tags 用 jsonb GIN 支持 @> 包含查询
create index if not exists idx_notes_tags on public.knowledge_notes using gin (tags);

drop trigger if exists trg_notes_updated_at on public.knowledge_notes;
create trigger trg_notes_updated_at
    before update on public.knowledge_notes
    for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- knowledge_note_chunks: 笔记切片 + embedding
-- 与 material_chunks 同构 (1536d, HNSW)
-- -----------------------------------------------------------------------------
create table if not exists public.knowledge_note_chunks (
    id uuid primary key default gen_random_uuid(),
    note_id uuid not null references public.knowledge_notes(id) on delete cascade,
    chunk_index int not null,
    content text not null,
    char_count int not null,
    token_count int not null,
    embedding vector(1536) not null,
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);

create index if not exists idx_note_chunks_note on public.knowledge_note_chunks(note_id, chunk_index);
create index if not exists idx_note_chunks_hnsw on public.knowledge_note_chunks
    using hnsw (embedding vector_cosine_ops);

-- -----------------------------------------------------------------------------
-- RLS:学生只能读写自己的笔记 / 笔记切片
-- -----------------------------------------------------------------------------
alter table public.knowledge_notes enable row level security;
alter table public.knowledge_note_chunks enable row level security;

drop policy if exists "notes: read own" on public.knowledge_notes;
create policy "notes: read own" on public.knowledge_notes
    for select using (owner_id = auth.uid());

drop policy if exists "notes: insert own" on public.knowledge_notes;
create policy "notes: insert own" on public.knowledge_notes
    for insert with check (owner_id = auth.uid());

drop policy if exists "notes: update own" on public.knowledge_notes;
create policy "notes: update own" on public.knowledge_notes
    for update using (owner_id = auth.uid());

drop policy if exists "notes: delete own" on public.knowledge_notes;
create policy "notes: delete own" on public.knowledge_notes
    for delete using (owner_id = auth.uid());

drop policy if exists "note_chunks: read via parent" on public.knowledge_note_chunks;
create policy "note_chunks: read via parent" on public.knowledge_note_chunks
    for select using (
        exists (
            select 1 from public.knowledge_notes n
            where n.id = knowledge_note_chunks.note_id and n.owner_id = auth.uid()
        )
    );
-- chunks 的 insert/delete/update 通过 service_role 在后端处理,无需 anon 策略

-- -----------------------------------------------------------------------------
-- RPC: match_knowledge_notes  — 笔记向量召回
-- 与 match_material_chunks 同语义,但限定 owner_id
-- -----------------------------------------------------------------------------
create or replace function public.match_knowledge_notes(
    query_embedding vector(1536),
    match_count int default 5,
    p_owner_id uuid default null,
    p_note_ids uuid[] default null
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
        (p_owner_id is null or n.owner_id = p_owner_id)
        and (p_note_ids is null or n.id = any(p_note_ids))
    order by c.embedding <=> query_embedding
    limit match_count;
$$;

comment on function public.match_knowledge_notes is 'pgvector top-k 笔记召回,Phase 5 RAG 二级源';
