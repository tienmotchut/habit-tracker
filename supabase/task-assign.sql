-- =====================================================================
--  Task không cần chủ nhóm duyệt nữa.
--  - Ai cũng tạo task được, task cho cả nhóm / cho chính mình -> có hiệu lực ngay.
--  - Giao task cho người khác -> người đó nhận @thông báo và phải bấm Accept / Decline.
--  Chủ đề (topic) và thành viên mới vẫn do chủ nhóm duyệt.
--  Chạy 1 lần trong SQL Editor (an toàn khi chạy lại).
-- =====================================================================

create or replace function public.task_rules() returns trigger
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then return new; end if;            -- SQL editor: giữ nguyên
  if tg_op = 'INSERT' then
    new.created_by := uid;
    new.status := case when new.assignee_id is null or new.assignee_id = uid then 'approved' else 'pending' end;
    return new;
  end if;
  new.created_by := old.created_by;
  if new.assignee_id is distinct from old.assignee_id then
    -- đổi người được giao -> người mới phải đồng ý (trừ khi giao cho cả nhóm / cho chính mình)
    new.status := case when new.assignee_id is null or new.assignee_id = uid then 'approved' else 'pending' end;
  elsif new.status is distinct from old.status then
    -- chỉ người được giao mới được Accept / Decline
    if not (uid = old.assignee_id and old.status = 'pending' and new.status in ('approved','rejected')) then
      new.status := old.status;
    end if;
  end if;
  return new;
end $$;

create or replace function public.task_messages() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  who  text := (select display_name from public.profiles where id = new.assignee_id);
begin
  if new.status = 'pending' and new.assignee_id is not null
     and (tg_op = 'INSERT' or old.assignee_id is distinct from new.assignee_id or old.status <> 'pending') then
    insert into public.messages (user_id, kind, content, ref_type, ref_id)
    values (coalesce(auth.uid(), new.created_by), 'chat',
            '@' || coalesce(who, '?') || ' assigned you a task: ' || new.title || '. Please accept or decline.',
            'task', new.id);
  elsif tg_op = 'UPDATE' and old.status = 'pending' and new.status in ('approved','rejected')
        and auth.uid() = new.assignee_id then
    insert into public.messages (user_id, kind, content, ref_type, ref_id)
    values (auth.uid(), 'system',
            case when new.status = 'approved' then '✅ ' || coalesce(who, '?') || ' accepted the task: '
                 else '❌ ' || coalesce(who, '?') || ' declined the task: ' end || new.title,
            'task', new.id);
  end if;
  return new;
end $$;

drop trigger if exists enforce_approval on public.tasks;
drop trigger if exists post_approval_message on public.tasks;
drop trigger if exists task_rules on public.tasks;
create trigger task_rules before insert or update on public.tasks
  for each row execute function public.task_rules();
drop trigger if exists task_messages on public.tasks;
create trigger task_messages after insert or update on public.tasks
  for each row execute function public.task_messages();

-- Ai được sửa / xoá task
drop policy if exists "tasks update" on public.tasks;
create policy "tasks update" on public.tasks for update to authenticated
  using (public.is_member() and (public.is_owner() or created_by = auth.uid() or assignee_id = auth.uid()));
drop policy if exists "tasks delete" on public.tasks;
create policy "tasks delete" on public.tasks for delete to authenticated
  using (public.is_owner() or created_by = auth.uid());

-- Task cũ đang chờ chủ nhóm duyệt: task chung / tự giao -> có hiệu lực luôn
update public.tasks set status = 'approved'
where status = 'pending' and (assignee_id is null or assignee_id = created_by);
