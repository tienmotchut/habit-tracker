-- Thêm loại task "One time" (làm 1 lần, có hạn). Chạy 1 lần trong SQL Editor.
alter table public.tasks add column if not exists due_date date;
alter table public.tasks drop constraint if exists tasks_frequency_check;
alter table public.tasks add constraint tasks_frequency_check check (frequency in ('daily','weekly','once'));

-- Báo cho API nạp lại cấu trúc bảng ngay
notify pgrst, 'reload schema';
