-- Dấu "Đã xem" trong chat. Chạy 1 lần trong SQL Editor.
create table if not exists public.chat_reads (
  user_id      uuid primary key default auth.uid() references public.profiles(id) on delete cascade,
  last_read_id bigint not null default 0,
  updated_at   timestamptz not null default now()
);
alter table public.chat_reads enable row level security;
drop policy if exists "reads read" on public.chat_reads;
create policy "reads read" on public.chat_reads for select to authenticated using (public.is_member());
drop policy if exists "reads insert" on public.chat_reads;
create policy "reads insert" on public.chat_reads for insert to authenticated with check (user_id = auth.uid() and public.is_member());
drop policy if exists "reads update" on public.chat_reads;
create policy "reads update" on public.chat_reads for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update on public.chat_reads to authenticated;
grant all on public.chat_reads to service_role;
do $$ begin
  alter publication supabase_realtime add table public.chat_reads;
exception when duplicate_object then null; end $$;
notify pgrst, 'reload schema';
