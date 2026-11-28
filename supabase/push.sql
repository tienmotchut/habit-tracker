-- =====================================================================
--  Thông báo điện thoại (Web Push) — chạy SAU schema.sql, 1 lần.
--  Supabase > SQL Editor > New query > dán file này > Run.
--  Cần deploy Edge Function "notify" (supabase/functions/notify/index.ts).
-- =====================================================================

-- Thiết bị đã bật thông báo
create table if not exists public.push_subscriptions (
  endpoint   text primary key,
  user_id    uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  p256dh     text not null,
  auth       text not null,
  user_agent text,
  created_at timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;
drop policy if exists "push own read" on public.push_subscriptions;
create policy "push own read" on public.push_subscriptions for select to authenticated using (user_id = auth.uid());
drop policy if exists "push own insert" on public.push_subscriptions;
create policy "push own insert" on public.push_subscriptions for insert to authenticated with check (user_id = auth.uid() and public.is_member());
drop policy if exists "push own update" on public.push_subscriptions;
create policy "push own update" on public.push_subscriptions for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "push own delete" on public.push_subscriptions;
create policy "push own delete" on public.push_subscriptions for delete to authenticated using (user_id = auth.uid());
grant select, insert, update, delete on public.push_subscriptions to authenticated;

-- Khoá VAPID (function tự tạo) + nhật ký chống gửi trùng: chỉ máy chủ đọc được
create table if not exists public.push_config (
  id          int primary key,
  public_key  text not null,
  private_key text not null
);
create table if not exists public.push_log (
  key        text primary key,
  created_at timestamptz not null default now()
);
alter table public.push_config enable row level security;
alter table public.push_log    enable row level security;
revoke all on public.push_config, public.push_log from anon, authenticated;

-- Gọi function khi có tin nhắn mới (@nhắc tên, đề xuất, kết quả duyệt)
create extension if not exists pg_net with schema extensions;

create or replace function public.notify_new_message() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform net.http_post(
    url     := 'https://fffhjcqyffpnrioybmpj.supabase.co/functions/v1/smooth-api',
    body    := jsonb_build_object('type', 'message', 'id', new.id),
    headers := '{"Content-Type": "application/json"}'::jsonb
  );
  return new;
end $$;

drop trigger if exists notify_new_message on public.messages;
create trigger notify_new_message after insert on public.messages
  for each row execute function public.notify_new_message();

-- Kiểm tra giờ nhắc mỗi phút (pg_cron, miễn phí)
create extension if not exists pg_cron;

select cron.unschedule(jobname) from cron.job where jobname in ('habit-reminders', 'habit-push-cleanup');

select cron.schedule('habit-reminders', '* * * * *', $job$
  select net.http_post(
    url     := 'https://fffhjcqyffpnrioybmpj.supabase.co/functions/v1/smooth-api',
    body    := '{"type": "reminders"}'::jsonb,
    headers := '{"Content-Type": "application/json"}'::jsonb
  );
$job$);

select cron.schedule('habit-push-cleanup', '0 3 * * *', $job$
  delete from public.push_log where created_at < now() - interval '14 days';
  delete from net._http_response where created < now() - interval '1 day';
$job$);
