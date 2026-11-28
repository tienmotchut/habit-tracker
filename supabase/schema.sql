-- =====================================================================
--  Habit Tracker nhóm — cơ sở dữ liệu Supabase
--  Cách dùng: Supabase Dashboard > SQL Editor > New query > dán toàn bộ
--  file này > Run. Chạy 1 lần duy nhất trên project mới.
-- =====================================================================

-- ---------- Bảng thành viên ----------
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  role         text not null default 'member' check (role in ('owner','member')),
  approved     boolean not null default false,
  created_at   timestamptz not null default now()
);

-- Hàm kiểm tra quyền (security definer để dùng được trong RLS)
create or replace function public.is_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'owner');
$$;

create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and approved);
$$;

-- Người đăng ký ĐẦU TIÊN tự động là owner (người duyệt duy nhất).
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare first_user boolean;
begin
  select not exists (select 1 from public.profiles where role = 'owner') into first_user;
  insert into public.profiles (id, display_name, role, approved)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data->>'display_name',''), split_part(new.email,'@',1)),
    case when first_user then 'owner' else 'member' end,
    first_user
  );
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Thành viên không tự đổi role / approved của mình được
create or replace function public.protect_profile() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_owner() then
    new.role := old.role;
    new.approved := old.approved;
  end if;
  return new;
end $$;

drop trigger if exists protect_profile on public.profiles;
create trigger protect_profile before update on public.profiles
  for each row execute function public.protect_profile();

-- ---------- Chủ đề ----------
create table if not exists public.topics (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  icon       text not null default '⭐',
  color      text not null default '#2f8f3f',
  status     text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

-- ---------- Task ----------
create table if not exists public.tasks (
  id            uuid primary key default gen_random_uuid(),
  topic_id      uuid not null references public.topics(id) on delete cascade,
  title         text not null,
  description   text,
  frequency     text not null default 'daily' check (frequency in ('daily','weekly')),
  reminder_time time,
  assignee_id   uuid references public.profiles(id) on delete set null,  -- null = cả nhóm
  status        text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Chỉ owner được duyệt: thành viên tạo / sửa => luôn về trạng thái "chờ duyệt".
-- Owner tạo => duyệt luôn.
create or replace function public.enforce_approval() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then          -- chạy từ SQL editor: giữ nguyên
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.status := case when public.is_owner() then 'approved' else 'pending' end;
  else
    new.created_by := old.created_by;
    if not public.is_owner() then
      new.status := 'pending';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists enforce_approval on public.topics;
create trigger enforce_approval before insert or update on public.topics
  for each row execute function public.enforce_approval();
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at := now(); return new; end $$;
drop trigger if exists touch_updated_at on public.tasks;
create trigger touch_updated_at before update on public.tasks
  for each row execute function public.touch_updated_at();
drop trigger if exists enforce_approval on public.tasks;
create trigger enforce_approval before insert or update on public.tasks
  for each row execute function public.enforce_approval();

-- ---------- Hoàn thành (check-in + minh chứng) ----------
create table if not exists public.checkins (
  id           uuid primary key default gen_random_uuid(),
  task_id      uuid not null references public.tasks(id) on delete cascade,
  user_id      uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  period_start date not null,               -- ngày (daily) hoặc thứ Hai của tuần (weekly)
  done_on      date not null,               -- ngày thực tế hoàn thành
  note         text,
  proof_path   text,
  proof_name   text,
  created_at   timestamptz not null default now(),
  unique (task_id, user_id, period_start)
);

-- ---------- Chat ----------
create table if not exists public.messages (
  id         bigint generated always as identity primary key,
  user_id    uuid references public.profiles(id) on delete set null,
  kind       text not null default 'chat' check (kind in ('chat','proposal','join','system')),
  content    text not null,
  ref_type   text check (ref_type in ('topic','task','member')),
  ref_id     uuid,
  created_at timestamptz not null default now()
);

-- Tự đẩy đề xuất / kết quả duyệt lên chat
create or replace function public.post_approval_message() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  label text;
  rtype text := case when tg_table_name = 'topics' then 'topic' else 'task' end;
  noun  text := case when tg_table_name = 'topics' then 'topic' else 'task' end;
begin
  label := coalesce(to_jsonb(new)->>'name', to_jsonb(new)->>'title');
  if new.status = 'pending' and (tg_op = 'INSERT' or old.status <> 'pending') then
    insert into public.messages (user_id, kind, content, ref_type, ref_id)
    values (new.created_by, 'proposal',
            case when tg_op = 'INSERT' then 'proposed a new ' || noun || ': ' else 'edited a ' || noun || ', needs re-approval: ' end || label
              || case when to_jsonb(new)->>'assignee_id' is not null
                      then ' (for ' || coalesce((select display_name from public.profiles where id = (to_jsonb(new)->>'assignee_id')::uuid), '?') || ')'
                      else '' end,
            rtype, new.id);
  elsif tg_op = 'UPDATE' and old.status = 'pending' and new.status in ('approved','rejected') then
    insert into public.messages (user_id, kind, content, ref_type, ref_id)
    values (auth.uid(), 'system',
            case when new.status = 'approved' then '✅ Approved ' else '❌ Declined ' end || noun || ': ' || label,
            rtype, new.id);
  end if;
  return new;
end $$;

drop trigger if exists post_approval_message on public.topics;
create trigger post_approval_message after insert or update of status, name on public.topics
  for each row execute function public.post_approval_message();
drop trigger if exists post_approval_message on public.tasks;
create trigger post_approval_message after insert or update on public.tasks
  for each row execute function public.post_approval_message();

create or replace function public.post_member_message() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' and not new.approved then
    insert into public.messages (user_id, kind, content, ref_type, ref_id)
    values (new.id, 'join', 'wants to join the group', 'member', new.id);
  elsif tg_op = 'UPDATE' and new.approved and not old.approved then
    insert into public.messages (user_id, kind, content, ref_type, ref_id)
    values (new.id, 'system', '🎉 ' || new.display_name || ' joined the group', 'member', new.id);
  end if;
  return new;
end $$;

drop trigger if exists post_member_message on public.profiles;
create trigger post_member_message after insert or update of approved on public.profiles
  for each row execute function public.post_member_message();

-- ---------- Bảo mật hàng (RLS) ----------
alter table public.profiles enable row level security;
alter table public.topics   enable row level security;
alter table public.tasks    enable row level security;
alter table public.checkins enable row level security;
alter table public.messages enable row level security;

-- profiles
drop policy if exists "profiles read" on public.profiles;
create policy "profiles read" on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_member());
drop policy if exists "profiles update" on public.profiles;
create policy "profiles update" on public.profiles for update to authenticated
  using (id = auth.uid() or public.is_owner());
drop policy if exists "profiles delete" on public.profiles;
create policy "profiles delete" on public.profiles for delete to authenticated
  using (public.is_owner() and id <> auth.uid());

-- topics
drop policy if exists "topics read" on public.topics;
create policy "topics read" on public.topics for select to authenticated using (public.is_member());
drop policy if exists "topics insert" on public.topics;
create policy "topics insert" on public.topics for insert to authenticated with check (public.is_member());
drop policy if exists "topics update" on public.topics;
create policy "topics update" on public.topics for update to authenticated
  using (public.is_owner() or (public.is_member() and created_by = auth.uid()));
drop policy if exists "topics delete" on public.topics;
create policy "topics delete" on public.topics for delete to authenticated
  using (public.is_owner() or (created_by = auth.uid() and status = 'pending'));

-- tasks
drop policy if exists "tasks read" on public.tasks;
create policy "tasks read" on public.tasks for select to authenticated using (public.is_member());
drop policy if exists "tasks insert" on public.tasks;
create policy "tasks insert" on public.tasks for insert to authenticated with check (public.is_member());
drop policy if exists "tasks update" on public.tasks;
create policy "tasks update" on public.tasks for update to authenticated
  using (public.is_owner() or (public.is_member() and created_by = auth.uid()));
drop policy if exists "tasks delete" on public.tasks;
create policy "tasks delete" on public.tasks for delete to authenticated
  using (public.is_owner() or (created_by = auth.uid() and status = 'pending'));

-- checkins
drop policy if exists "checkins read" on public.checkins;
create policy "checkins read" on public.checkins for select to authenticated using (public.is_member());
drop policy if exists "checkins insert" on public.checkins;
create policy "checkins insert" on public.checkins for insert to authenticated
  with check (public.is_member() and user_id = auth.uid()
              and exists (select 1 from public.tasks t where t.id = task_id and t.status = 'approved'
                          and (t.assignee_id is null or t.assignee_id = auth.uid())));
drop policy if exists "checkins update" on public.checkins;
create policy "checkins update" on public.checkins for update to authenticated using (user_id = auth.uid());
drop policy if exists "checkins delete" on public.checkins;
create policy "checkins delete" on public.checkins for delete to authenticated using (user_id = auth.uid());

-- messages
drop policy if exists "messages read" on public.messages;
create policy "messages read" on public.messages for select to authenticated using (public.is_member());
drop policy if exists "messages insert" on public.messages;
create policy "messages insert" on public.messages for insert to authenticated
  with check (public.is_member() and user_id = auth.uid() and kind = 'chat');
drop policy if exists "messages delete" on public.messages;
create policy "messages delete" on public.messages for delete to authenticated
  using (user_id = auth.uid() or public.is_owner());

grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;

-- ---------- Lưu file minh chứng ----------
insert into storage.buckets (id, name, public, file_size_limit)
values ('proofs', 'proofs', false, 10485760)   -- tối đa 10 MB / file
on conflict (id) do nothing;

drop policy if exists "proofs read" on storage.objects;
create policy "proofs read" on storage.objects for select to authenticated
  using (bucket_id = 'proofs' and public.is_member());
drop policy if exists "proofs upload" on storage.objects;
create policy "proofs upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'proofs' and public.is_member()
              and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "proofs delete" on storage.objects;
create policy "proofs delete" on storage.objects for delete to authenticated
  using (bucket_id = 'proofs' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------- Realtime (chat + cập nhật tức thì) ----------
do $$
declare t text;
begin
  foreach t in array array['messages','topics','tasks','checkins','profiles'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

-- ---------- Dữ liệu mặc định ----------
insert into public.topics (name, icon, color, status)
select * from (values
  ('Fitness',                 '💪', '#2f8f3f', 'approved'),
  ('Hydration',               '💧', '#3aa676', 'approved'),
  ('Learn Chinese',           '🀄', '#eab308', 'approved'),
  ('Work',                    '💼', '#6b8e23', 'approved'),
  ('Family time',             '👨‍👩‍👧', '#f59e0b', 'approved')
) v where not exists (select 1 from public.topics);

insert into public.tasks (topic_id, title, description, frequency, reminder_time, status)
select t.id, x.title, x.descr, x.freq, x.rt::time, 'approved'
from (values
  ('Fitness',       'Work out for 30 minutes',            'Photo of your workout or a step-counter screenshot', 'daily',  '18:00'),
  ('Hydration',     'Drink 2 liters of water',            'Photo of your water bottle',                         'daily',  '09:00'),
  ('Learn Chinese', 'Learn 15 new words',                 'Photo of your notebook or study app',                'daily',  '21:00'),
  ('Work',          'Finish the most important task',     'Screenshot or result file',                          'daily',  '17:00'),
  ('Family time',   'Call your family',                   'Screenshot of the call',                             'weekly', '20:00')
) as x(topic, title, descr, freq, rt)
join public.topics t on t.name = x.topic
where not exists (select 1 from public.tasks);
