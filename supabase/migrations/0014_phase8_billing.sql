-- =============================================================================
-- Phase 8 · Billing / Entitlements (MVP)
--
-- 目标: 支持免费 vs Pro 两档, 管理员可以在后台给指定用户开 Pro (含过期时间).
--
-- 设计:
--   - 一张 user_plans 表 (user_id 主键), 无行 = free
--   - plan ∈ ('free','pro'); expires_at 可选, null=永不过期
--   - 只允许后端 service_role 写 (前端只读自己那行 via RPC/API, 不直接查表)
--   - RLS: 用户只能读自己的; 服务端全权
--
-- 用法:
--   - 后端 entitlements.get_effective_plan(uid) 会 join 这张表 + 判断过期
--   - 管理员通过 POST /api/admin/users/{uid}/plan 写这张表
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.user_plans (
    user_id     UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    plan        TEXT NOT NULL DEFAULT 'free'
                CHECK (plan IN ('free', 'pro')),
    expires_at  TIMESTAMPTZ,       -- null = 永不过期 (grandfathered / admin gift)
    granted_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    granted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    note        TEXT               -- 后台开通时可以填一行原因
);

CREATE INDEX IF NOT EXISTS user_plans_plan_idx    ON public.user_plans(plan);
CREATE INDEX IF NOT EXISTS user_plans_expires_idx ON public.user_plans(expires_at);

-- RLS: 用户只能读自己那行 (给前端未来直连留后路); 写只走后端 service_role.
ALTER TABLE public.user_plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_plans_self_read ON public.user_plans;
CREATE POLICY user_plans_self_read ON public.user_plans
    FOR SELECT
    USING (user_id = auth.uid());

-- 无 INSERT / UPDATE / DELETE 策略 → 只有 service_role (bypass RLS) 能写.
