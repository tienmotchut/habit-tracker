-- Cho phép máy chủ (Edge Function) đọc/ghi các bảng.
-- Cần khi project tạo với tuỳ chọn "Grant API access to new tables automatically" bị tắt.
grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;
