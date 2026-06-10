-- =============================================================================
-- Phase 5 — student_profiles 扩展:支持自由学习者 (非 K12)
-- =============================================================================

-- 学习者类型
alter table public.student_profiles
    add column if not exists learner_type text not null default 'k12_student'
        check (learner_type in ('k12_student', 'free_learner'));

-- 自由学习者的关注领域 tags (例:["量化交易","系统设计","面试准备"])
alter table public.student_profiles
    add column if not exists focus_domains jsonb not null default '[]'::jsonb;

-- 自由学习者可能没有"年级"概念 — 解除 not null (历史数据保留原值)
do $$
begin
    if exists (
        select 1 from information_schema.columns
        where table_schema = 'public'
          and table_name = 'student_profiles'
          and column_name = 'grade'
          and is_nullable = 'NO'
    ) then
        alter table public.student_profiles alter column grade drop not null;
    end if;
end$$;

comment on column public.student_profiles.learner_type is
    'k12_student=初高中学生 (有年级/教材/科目);free_learner=自由学习者 (关注领域)';
comment on column public.student_profiles.focus_domains is
    '自由学习者的关注领域 tags,jsonb 数组;K12 学生为 []';
