-- =============================================================================
-- 学生学习驾驶舱 - Phase 4 图片对话 migration
-- 给 chat 创建专用的 Storage bucket,学生可上传题目截图让老师看图讲题
-- 在 Supabase SQL Editor 中执行此文件
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Storage bucket: chat-attachments
-- - private (非公开,后端用 service_role 拉取,base64 inline 给 OpenAI)
-- - 学生只能在以自己 user_id 命名的子目录下增/删/读
-- - 路径规则:chat-attachments/<user_id>/<uuid>.<ext>
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('chat-attachments', 'chat-attachments', false)
on conflict (id) do nothing;

drop policy if exists "chat-attachments: students read own folder" on storage.objects;
create policy "chat-attachments: students read own folder"
    on storage.objects for select
    using (
        bucket_id = 'chat-attachments'
        and (storage.foldername(name))[1] = auth.uid()::text
    );

drop policy if exists "chat-attachments: students upload own folder" on storage.objects;
create policy "chat-attachments: students upload own folder"
    on storage.objects for insert
    with check (
        bucket_id = 'chat-attachments'
        and (storage.foldername(name))[1] = auth.uid()::text
    );

drop policy if exists "chat-attachments: students delete own folder" on storage.objects;
create policy "chat-attachments: students delete own folder"
    on storage.objects for delete
    using (
        bucket_id = 'chat-attachments'
        and (storage.foldername(name))[1] = auth.uid()::text
    );

-- 说明:
-- chat_messages 没有新增字段。图片信息存在 metadata jsonb 里:
--   metadata.image_urls = ["chat-attachments/<uid>/<uuid>.png", ...]
-- 这样不需要 schema migration,前后端统一从 metadata 读取。
-- 后端调用 OpenAI vision 前用 service_role 把 storage object 拉下来转 base64。
