-- =============================================================================
-- 学生学习驾驶舱 - 种子数据
-- 在 migration 执行完后,运行此文件填入基础数据
-- =============================================================================

-- 学科 (MVP 阶段聚焦初中三主科)
insert into public.subjects (id, name, stage, description, sort_order) values
    ('math',    '数学', 'junior_high', '初中数学,涵盖数与式、方程与不等式、函数、几何、统计与概率', 1),
    ('english', '英语', 'junior_high', '初中英语,涵盖词汇、语法、阅读理解、完形填空、写作', 2),
    ('chinese', '语文', 'junior_high', '初中语文,涵盖现代文阅读、文言文、古诗词、作文、基础知识', 3)
on conflict (id) do update set
    name = excluded.name,
    stage = excluded.stage,
    description = excluded.description,
    sort_order = excluded.sort_order;
