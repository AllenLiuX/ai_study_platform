-- =============================================================================
-- Phase 6.1 — 练习 → 笔记
-- knowledge_notes.source 的 CHECK 扩展,允许 'practice'
-- (练习笔记不挂 origin_session_id — 那个 FK 指向 chat_sessions;
--  回溯用 metadata 不需要,练习入口在 /practice 列表里)
-- =============================================================================

alter table public.knowledge_notes
    drop constraint if exists knowledge_notes_source_check;

alter table public.knowledge_notes
    add constraint knowledge_notes_source_check
    check (source in ('chat', 'manual', 'imported', 'practice'));
