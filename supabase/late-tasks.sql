-- =====================================================================
--  Task trễ / không làm được
--  - Bảng task_skips: "Skip" một ngày (hoặc một tuần / task một lần) kèm lý do.
--    Ngày đã skip không bị tính là bỏ lửng trong tiến độ.
--  - Hàm postpone_task: dời hạn task một lần (One time), báo vào chat.
--  Chạy 1 lần trong SQL Editor (an toàn khi chạy lại).
-- =====================================================================

create table if not exists public.task_skips (
  id           uuid primary key default gen_random_uuid(),
  task_id      uuid not null references public.tasks(id) on delete cascade,
  user_id      uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  period_start date not null,
  reason       text not null check (length(trim(reason)) > 0 and length(reason) <= 300),
  created_at   timestamptz not null default now(),
  unique (task_id, user_id, period_start)
);

alter table public.task_skips enable row level security;
drop policy if exists "skips read" on public.task_skips;
create policy "skips read" on public.task_skips for select to authenticated using (public.is_member());
drop policy if exists "skips insert" on public.task_skips;
create policy "skips insert" on public.task_skips for insert to authenticated
  with check (public.is_member() and user_id = auth.uid());
drop policy if exists "skips delete" on public.task_skips;
create policy "skips delete" on public.task_skips for delete to authenticated using (user_id = auth.uid());

grant select, insert, delete on public.task_skips to authenticated;
grant all on public.task_skips to service_role;

-- ---------- Giới hạn Skip + Postpone mỗi tuần ----------
create table if not exists public.app_settings (
  id                int primary key default 1 check (id = 1),
  weekly_skip_limit int not null default 2 check (weekly_skip_limit between 0 and 50)
);
insert into public.app_settings (id) values (1) on conflict do nothing;
alter table public.app_settings enable row level security;
drop policy if exists "settings read" on public.app_settings;
create policy "settings read" on public.app_settings for select to authenticated using (public.is_member());
drop policy if exists "settings update" on public.app_settings;
create policy "settings update" on public.app_settings for update to authenticated using (public.is_owner());
grant select, update on public.app_settings to authenticated;
grant all on public.app_settings to service_role;

create table if not exists public.task_postpones (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null references public.tasks(id) on delete cascade,
  user_id    uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.task_postpones enable row level security;
drop policy if exists "postpones read" on public.task_postpones;
create policy "postpones read" on public.task_postpones for select to authenticated using (public.is_member());
grant select on public.task_postpones to authenticated;
grant all on public.task_postpones to service_role;

-- Số lần đã Skip + Postpone trong tuần này (thứ Hai -> Chủ nhật, giờ Việt Nam)
create or replace function public.used_skips(p_user uuid) returns int
language sql stable security definer set search_path = public as $$
  with w as (select date_trunc('week', now() at time zone 'Asia/Ho_Chi_Minh') at time zone 'Asia/Ho_Chi_Minh' as start)
  select ((select count(*) from public.task_skips, w where user_id = p_user and created_at >= w.start)
        + (select count(*) from public.task_postpones, w where user_id = p_user and created_at >= w.start))::int
$$;

create or replace function public.check_skip_limit() returns trigger
language plpgsql security definer set search_path = public as $$
declare lim int := coalesce((select weekly_skip_limit from public.app_settings where id = 1), 2);
begin
  if public.used_skips(new.user_id) >= lim then
    raise exception 'Weekly limit reached: you can skip or postpone % times per week', lim;
  end if;
  return new;
end $$;
drop trigger if exists check_skip_limit on public.task_skips;
create trigger check_skip_limit before insert on public.task_skips
  for each row execute function public.check_skip_limit();

-- Báo vào chat khi ai đó skip
create or replace function public.skip_message() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.messages (user_id, kind, content, ref_type, ref_id)
  values (new.user_id, 'system',
          '⏭ ' || coalesce((select display_name from public.profiles where id = new.user_id), '?') ||
          ' skipped "' || coalesce((select title from public.tasks where id = new.task_id), '?') || '": ' || new.reason,
          'task', new.task_id);
  return new;
end $$;
drop trigger if exists skip_message on public.task_skips;
create trigger skip_message after insert on public.task_skips
  for each row execute function public.skip_message();

-- Dời hạn task một lần
create or replace function public.postpone_task(p_task uuid, p_date date)
returns void language plpgsql security definer set search_path = public as $$
declare t public.tasks; uid uuid := auth.uid();
begin
  select * into t from public.tasks where id = p_task;
  if t.id is null then raise exception 'Task not found'; end if;
  if not public.is_member() then raise exception 'Not allowed'; end if;
  if t.frequency <> 'once' then raise exception 'Only one-time tasks can be postponed'; end if;
  if not (public.is_owner() or t.created_by = uid or t.assignee_id = uid or t.assignee_id is null) then
    raise exception 'Not allowed';
  end if;
  if p_date < (now() at time zone 'Asia/Ho_Chi_Minh')::date then raise exception 'Pick today or a later date'; end if;
  if p_date = t.due_date then return; end if;
  if public.used_skips(uid) >= coalesce((select weekly_skip_limit from public.app_settings where id = 1), 2) then
    raise exception 'Weekly limit reached: you can skip or postpone % times per week',
      coalesce((select weekly_skip_limit from public.app_settings where id = 1), 2);
  end if;
  update public.tasks set due_date = p_date where id = p_task;
  insert into public.task_postpones (task_id, user_id) values (p_task, uid);
  insert into public.messages (user_id, kind, content, ref_type, ref_id)
  values (uid, 'system',
          '⏩ ' || coalesce((select display_name from public.profiles where id = uid), '?') ||
          ' postponed "' || t.title || '" to ' || to_char(p_date, 'Mon DD'),
          'task', t.id);
end $$;
revoke all on function public.postpone_task(uuid, date) from public;
grant execute on function public.postpone_task(uuid, date) to authenticated;

do $$ begin
  alter publication supabase_realtime add table public.task_skips;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.task_postpones;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.app_settings;
exception when duplicate_object then null; end $$;

notify pgrst, 'reload schema';
