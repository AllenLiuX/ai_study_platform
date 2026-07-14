-- Phase 6.2: 听课 (Lecture) 蒸馏笔记
-- knowledge_notes.source 的 CHECK 扩展,允许 'lecture'
-- 结构参照 0011_phase6_note_source_practice.sql

alter table public.knowledge_notes
    drop constraint if exists knowledge_notes_source_check;

alter table public.knowledge_notes
    add constraint knowledge_notes_source_check
    check (source in ('chat', 'manual', 'imported', 'practice', 'lecture'));
