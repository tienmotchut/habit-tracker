# 🌿 Habit Circle

Web theo dõi thói quen cho cả nhóm: tạo & giao task, nộp ảnh/file minh chứng mỗi ngày, xem tiến độ dạng heatmap, chat và duyệt đề xuất. Chạy trên **GitHub Pages** (miễn phí) + **Supabase** (miễn phí) cho đăng nhập, dữ liệu, lưu ảnh và chat realtime.

## Tính năng

- **Chủ đề mặc định**: Fitness, Uống đủ nước, Học tiếng Trung, Công việc, Nói chuyện với gia đình (mỗi chủ đề có sẵn 1 task mẫu).
- **Task**: ai cũng tạo được. Task cho cả nhóm / cho mình có hiệu lực ngay. Giao cho người khác → người đó nhận @thông báo và bấm **Accept / Decline**.
- **Chủ nhóm** (người đăng ký đầu tiên) duyệt **chủ đề mới** và **thành viên mới**.
- **Task một lần (One time)** có hạn chót, hiện mỗi ngày tới khi xong.
- **Chat** có dấu "Seen" (đã xem) — cần chạy [`supabase/seen.sql`](supabase/seen.sql).
- Đã cài từ trước? Chạy thêm [`supabase/task-assign.sql`](supabase/task-assign.sql) và [`supabase/one-time.sql`](supabase/one-time.sql) trong SQL Editor.
- **Hôm nay**: mỗi task mỗi ngày (hoặc mỗi tuần) có nút **Nộp ảnh / file minh chứng**. Xem được minh chứng của người khác.
- **Daily / Weekly + nhắc nhở**: trong phần sửa task chọn Hằng ngày / Hằng tuần và giờ nhắc. Nhắc bằng thông báo trình duyệt (khi web đang mở) và nút 📅 tải file lịch `.ics` để điện thoại/Google Calendar tự nhắc hằng ngày/tuần.
- **Tiến độ**: heatmap từng thành viên (ô càng xanh đậm càng làm nhiều, ô vàng = xong 100%), lọc theo chủ đề, bảng xếp hạng tuần, chuỗi ngày 🔥.
- **Chat & Duyệt**: chat realtime cả nhóm; đề xuất chủ đề/task và yêu cầu tham gia tự hiện trong chat kèm nút Duyệt / Từ chối cho chủ nhóm.

---

## Cài đặt (khoảng 10 phút, làm 1 lần)

### Bước 1. Tạo project Supabase
1. Vào https://supabase.com → **Start your project** → đăng nhập bằng GitHub.
2. **New project** → đặt tên (vd `habit-tracker`), đặt mật khẩu database (lưu lại), Region chọn **Southeast Asia (Singapore)** → **Create new project**. Đợi ~1 phút.

### Bước 2. Tạo cơ sở dữ liệu
1. Trong project Supabase, menu trái chọn **SQL Editor** → **New query**.
2. Mở file [`supabase/schema.sql`](supabase/schema.sql) trong repo này, copy **toàn bộ**, dán vào, bấm **Run**. Thấy “Success” là xong.
3. Nếu bạn đã chạy `schema.sql` **bản tiếng Việt cũ** trước đó, chạy thêm [`supabase/update-english.sql`](supabase/update-english.sql) để đổi tin nhắn hệ thống và tên chủ đề mặc định sang tiếng Anh.

### Bước 3. Cấu hình đăng nhập
Menu **Authentication**:
- **URL Configuration** → **Site URL** điền `https://<tên-github>.github.io/<tên-repo>/` (vd `https://tienmotchut.github.io/habit-tracker/`) → Save. Thêm cùng link đó vào **Redirect URLs**.
- (Tuỳ chọn, cho nhanh) **Sign In / Providers → Email** → tắt **Confirm email** để đăng ký xong vào luôn, không cần bấm link trong email. Nếu để bật, gói free chỉ gửi được vài email/giờ.

### Bước 4. Lấy key và điền vào web
1. Supabase → **Project Settings** → **API** (hoặc **Data API** / **API Keys**). Copy:
   - **Project URL** (dạng `https://abcxyz.supabase.co`)
   - **anon public** key (chuỗi dài bắt đầu bằng `eyJ...`, hoặc key `sb_publishable_...`)
2. Trên GitHub, mở file `js/config.js` → bấm ✏️ (Edit) → thay 2 giá trị `SUPABASE_URL` và `SUPABASE_ANON_KEY` → **Commit changes**.

> Key **anon/publishable** là key công khai, để trong web là bình thường; dữ liệu đã được bảo vệ bằng Row Level Security. **Không bao giờ** dán key `service_role` / `secret` vào đây.

### Bước 5. Bật GitHub Pages
Repo trên GitHub → **Settings** → **Pages** → Source: **Deploy from a branch** → Branch: `main`, thư mục `/ (root)` → **Save**. Sau 1–2 phút web chạy ở `https://<tên-github>.github.io/<tên-repo>/`.

### Bước 6. Đăng ký
1. **Bạn đăng ký trước tiên** → tự động thành **chủ nhóm**.
2. Gửi link cho các thành viên đăng ký → họ hiện trong tab **Chat & Duyệt** → bạn bấm **Duyệt**.

---

## Cấu trúc

```
index.html          trang web
css/style.css       giao diện (tông xanh – vàng)
js/config.js        URL + key Supabase (bạn điền)
js/app.js           toàn bộ logic
supabase/schema.sql bảng, phân quyền, trigger, lưu file, realtime
```

## Ghi chú
- Ảnh lớn hơn 1,5 MB được tự nén trước khi tải lên; giới hạn 10 MB/file. Gói free Supabase có 1 GB lưu file.
- Project Supabase free sẽ **tạm dừng nếu 7 ngày không ai dùng**; vào dashboard bấm Restore là chạy lại.
- Đổi chủ nhóm: SQL Editor chạy `update profiles set role='owner', approved=true where display_name='Tên';`

---

## 🔔 Thông báo điện thoại (miễn phí, tuỳ chọn)

Gửi thông báo khi có người **@nhắc tên** bạn, khi **đến giờ nhắc task** chưa làm, và (cho chủ nhóm) khi có **đề xuất cần duyệt**. Dùng Web Push + Supabase Edge Function, nằm trong gói Free (≈45.000 lượt gọi/tháng, giới hạn free là 500.000).

1. **Tạo function**: Supabase → **Edge Functions** → **Deploy a new function** → **Via Editor**. Đặt tên **`notify`**, xoá code mẫu, dán toàn bộ [`supabase/functions/notify/index.ts`](supabase/functions/notify/index.ts) → **Deploy**.
2. **Tắt Verify JWT**: mở function `notify` → **Details / Settings** → tắt **Verify JWT with legacy secret** (hoặc "Enforce JWT verification") → Save.
3. **Chạy SQL**: SQL Editor → dán [`supabase/push.sql`](supabase/push.sql) → **Run**.
4. Trên web bấm 🔔 → **Turn on** → **Send me a test notification**.

Lưu ý:
- **iPhone/iPad** (iOS 16.4+): phải mở Safari → **Chia sẻ → Thêm vào MH chính**, mở Habit Circle từ màn hình chính rồi mới bật 🔔 được.
- **Android / máy tính**: bật thẳng trên Chrome, Edge, Firefox.
- Mỗi thiết bị bật 1 lần. Giờ nhắc tính theo giờ Việt Nam.
- Task weekly chưa xong sẽ được nhắc mỗi ngày (đúng giờ hẹn) cho đến khi xong trong tuần.
