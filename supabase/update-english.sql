-- Chạy file này trong SQL Editor NẾU bạn đã chạy schema.sql bản tiếng Việt trước đó.
-- Nó đổi tin nhắn hệ thống và tên chủ đề / task mặc định sang tiếng Anh. Không mất dữ liệu.

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

update public.topics set name = 'Hydration'     where name = 'Uống đủ nước';
update public.topics set name = 'Learn Chinese' where name = 'Học tiếng Trung';
update public.topics set name = 'Work'          where name = 'Công việc';
update public.topics set name = 'Family time'   where name = 'Nói chuyện với gia đình';

update public.tasks set title = 'Work out for 30 minutes',        description = 'Photo of your workout or a step-counter screenshot' where title = 'Tập thể dục 30 phút';
update public.tasks set title = 'Drink 2 liters of water',        description = 'Photo of your water bottle'                         where title = 'Uống đủ 2 lít nước';
update public.tasks set title = 'Learn 15 new words',             description = 'Photo of your notebook or study app'                where title = 'Học 15 từ mới';
update public.tasks set title = 'Finish the most important task', description = 'Screenshot or result file'                          where title = 'Xong việc quan trọng nhất ngày';
update public.tasks set title = 'Call your family',               description = 'Screenshot of the call'                             where title = 'Gọi điện cho gia đình';
