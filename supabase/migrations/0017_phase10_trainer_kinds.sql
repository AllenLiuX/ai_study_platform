-- =============================================================================
-- Phase 10.1 · 练习工坊升级为「交互式训练器」
--
-- 工坊的产物从"题目集"改为"交互式训练器"：
--   template = 参数化模板训练器（模拟器/计时/音频/SRS/拖拽/决策沙盘）
--   app      = AI 现场生成的自包含交互式微应用（隔离 iframe 运行）
-- 放宽 practice_specs.mode 的取值，兼容旧的 structured/sandbox 记录。
-- =============================================================================

alter table public.practice_specs
    drop constraint if exists practice_specs_mode_check;

alter table public.practice_specs
    add constraint practice_specs_mode_check
    check (mode in ('structured', 'sandbox', 'template', 'app'));
