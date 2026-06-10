-- =============================================================================
-- Phase 5 fix — 解锁 chat_sessions.agent_type 让其支持自定义老师
-- 
-- 背景:
--   0001_phase0_init.sql 把 agent_type 写死成了 4 个 builtin key 的 CHECK。
--   Phase 5 引入用户自定义老师后,agent_key 可以是任意字符串(如 "量化MLE导师"
--   或 slug),createSession 时就会被这个 CHECK 拒绝,前端表现为 "Failed to fetch"
--   (后端 supabase 抛错 → 500 → 浏览器 fetch 层捕获)。
--
-- 修复:
--   - 删掉 chat_sessions_agent_type_check
--   - 改用一个 lightweight 的非空 / 长度合理性 CHECK
--   - 不加 FK 到 user_agents.agent_key,因为软删除场景下旧 session 仍要可读
-- =============================================================================

-- 1. 找到并删除 0001 的 CHECK (Postgres 自动命名为 chat_sessions_agent_type_check)
alter table public.chat_sessions
    drop constraint if exists chat_sessions_agent_type_check;

-- 2. 加一个宽松的合理性约束:非空 + 长度 ≤ 100
--    (与 user_agents.agent_key 实际可能值兼容,中文 / slug / 4 builtin 都通过)
alter table public.chat_sessions
    add constraint chk_chat_sessions_agent_type_nonempty
    check (char_length(trim(agent_type)) between 1 and 100);

comment on column public.chat_sessions.agent_type is
    'Agent key — 可以是 user_agents.agent_key 的任意值 (Phase 5)。'
    ' 不做 FK,因为软删除 agent 时旧 session 仍需可读。';
