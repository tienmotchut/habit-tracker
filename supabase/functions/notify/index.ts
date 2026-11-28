// Supabase Edge Function "notify" — gửi thông báo đẩy (Web Push) miễn phí.
// Dán toàn bộ file này vào Supabase > Edge Functions > Deploy a new function > Via Editor,
// tên function trong web đang dùng: smooth-api   (và TẮT "Verify JWT").
//
// Function tự tạo cặp khoá VAPID ở lần chạy đầu và lưu trong bảng push_config,
// nên bạn KHÔNG cần tạo hay dán khoá bí mật nào.
//
// Được gọi bởi:
//   - trigger khi có tin nhắn mới     -> {type:"message", id}
//   - lịch pg_cron mỗi phút           -> {type:"reminders"}
//   - nút "Send me a test" trên web   -> {type:"test"} (kèm token đăng nhập)
//   - web lấy public key              -> GET

import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

const SITE_URL = "https://tienmotchut.github.io/habit-tracker/";
const TIME_ZONE = "Asia/Ho_Chi_Minh"; // giờ nhắc của task tính theo múi giờ này
const REMINDER_WINDOW_MIN = 30;       // nếu lỡ lịch, vẫn nhắc trong vòng 30 phút sau giờ hẹn

const sb = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (d, status = 200) =>
  new Response(JSON.stringify(d), { status, headers: { ...cors, "Content-Type": "application/json" } });

const fold = (x = "") =>
  x.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();

let cachedKeys = null;
async function vapid() {
  if (cachedKeys) return cachedKeys;
  let { data } = await sb.from("push_config").select("*").eq("id", 1).maybeSingle();
  if (!data) {
    const k = webpush.generateVAPIDKeys();
    await sb.from("push_config").upsert({ id: 1, public_key: k.publicKey, private_key: k.privateKey }, { onConflict: "id", ignoreDuplicates: true });
    ({ data } = await sb.from("push_config").select("*").eq("id", 1).single());
  }
  webpush.setVapidDetails(SITE_URL, data.public_key, data.private_key);
  cachedKeys = data;
  return data;
}

async function sendTo(userIds, payload) {
  const ids = [...new Set(userIds)].filter(Boolean);
  if (!ids.length) return 0;
  await vapid();
  const { data: subs } = await sb.from("push_subscriptions").select("*").in("user_id", ids);
  let sent = 0;
  await Promise.all((subs || []).map(async (s) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify(payload),
        { TTL: 6 * 3600, urgency: "high" },
      );
      sent++;
    } catch (e) {
      // thiết bị đã huỷ đăng ký -> xoá
      if (e?.statusCode === 404 || e?.statusCode === 410) await sb.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
      else console.error("push failed", e?.statusCode, e?.body || e?.message);
    }
  }));
  return sent;
}

/** Ghi log để không gửi trùng; trả về các key mới (chưa gửi lần nào) */
async function claim(keys) {
  if (!keys.length) return new Set();
  const { data, error } = await sb.from("push_log")
    .upsert(keys.map((key) => ({ key })), { onConflict: "key", ignoreDuplicates: true })
    .select("key");
  if (error) { console.error(error); return new Set(); }
  return new Set((data || []).map((r) => r.key));
}

async function onMessage(id) {
  const { data: m } = await sb.from("messages").select("*").eq("id", id).maybeSingle();
  if (!m) return 0;
  if (!(await claim([`msg:${id}`])).size) return 0;

  const { data: people } = await sb.from("profiles").select("id, display_name, role, approved");
  const byId = Object.fromEntries((people || []).map((p) => [p.id, p]));
  const author = byId[m.user_id]?.display_name || "Someone";
  const members = (people || []).filter((p) => p.approved && p.id !== m.user_id);
  const owners = (people || []).filter((p) => p.role === "owner" && p.id !== m.user_id).map((p) => p.id);

  if (m.kind === "chat") {
    const text = fold(m.content);
    const everyone = text.includes("@everyone");
    const targets = members.filter((p) => everyone || text.includes("@" + fold(p.display_name))).map((p) => p.id);
    return sendTo(targets, { title: `${author} mentioned you`, body: m.content.slice(0, 180), url: SITE_URL + "#chat", tag: `msg-${id}` });
  }
  if (m.kind === "proposal" || m.kind === "join") {
    return sendTo(owners, { title: "Needs your approval", body: `${author} ${m.content}`.slice(0, 180), url: SITE_URL + "#chat", tag: `ap-${m.ref_id || id}` });
  }
  if (m.kind === "system" && m.ref_id) {
    // báo cho người đề xuất biết đã được duyệt / từ chối
    let target = null;
    if (m.ref_type === "member") target = m.ref_id;
    else {
      const { data: ref } = await sb.from(m.ref_type === "topic" ? "topics" : "tasks").select("created_by").eq("id", m.ref_id).maybeSingle();
      target = ref?.created_by;
    }
    if (target && target !== m.user_id) return sendTo([target], { title: "Habit Circle", body: m.content.slice(0, 180), url: SITE_URL + "#manage", tag: `sys-${id}` });
  }
  return 0;
}

function localNow() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date());
  const g = (t) => parts.find((p) => p.type === t).value;
  const day = `${g("year")}-${g("month")}-${g("day")}`;
  return { day, mins: Number(g("hour")) * 60 + Number(g("minute")) };
}
function mondayOf(day) {
  const d = new Date(day + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

async function reminders() {
  const { day, mins } = localNow();
  const [{ data: tasks }, { data: topics }, { data: people }] = await Promise.all([
    sb.from("tasks").select("id, topic_id, title, description, frequency, reminder_time, assignee_id").eq("status", "approved").not("reminder_time", "is", null),
    sb.from("topics").select("id, icon, status"),
    sb.from("profiles").select("id").eq("approved", true),
  ]);
  const topicById = Object.fromEntries((topics || []).map((t) => [t.id, t]));
  const due = (tasks || []).filter((t) => {
    if (topicById[t.topic_id]?.status !== "approved") return false;
    const [h, m] = t.reminder_time.split(":").map(Number);
    const diff = mins - (h * 60 + m);
    return diff >= 0 && diff <= REMINDER_WINDOW_MIN;
  });
  if (!due.length) return 0;

  const periods = [...new Set([day, mondayOf(day)])];
  const { data: done } = await sb.from("checkins").select("task_id, user_id, period_start")
    .in("task_id", due.map((t) => t.id)).in("period_start", periods);
  const doneSet = new Set((done || []).map((c) => `${c.task_id}:${c.user_id}:${c.period_start}`));

  const jobs = [];
  for (const t of due) {
    const period = t.frequency === "weekly" ? mondayOf(day) : day;
    const users = t.assignee_id ? [t.assignee_id] : (people || []).map((p) => p.id);
    for (const u of users) {
      if (doneSet.has(`${t.id}:${u}:${period}`)) continue;
      jobs.push({ key: `rem:${t.id}:${u}:${day}`, user: u, t });
    }
  }
  const fresh = await claim(jobs.map((j) => j.key));
  let sent = 0;
  for (const j of jobs.filter((x) => fresh.has(x.key))) {
    const icon = topicById[j.t.topic_id]?.icon || "⏰";
    sent += await sendTo([j.user], {
      title: `${icon} ${j.t.title}`,
      body: j.t.frequency === "weekly" ? "Weekly task, not done yet this week. Upload your proof!" : "Time for your habit. Upload your proof when done!",
      url: SITE_URL + "#today",
      tag: `rem-${j.t.id}`,
    });
  }
  return sent;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    if (req.method === "GET") return json({ publicKey: (await vapid()).public_key });
    const body = await req.json().catch(() => ({}));
    if (body.type === "message") return json({ sent: await onMessage(Number(body.id)) });
    if (body.type === "reminders") return json({ sent: await reminders() });
    if (body.type === "test") {
      const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
      const { data } = await sb.auth.getUser(token);
      if (!data?.user) return json({ error: "Please sign in again." }, 401);
      const sent = await sendTo([data.user.id], { title: "Habit Circle 🌿", body: "Notifications are working on this device.", url: SITE_URL, tag: "test" });
      return json({ sent });
    }
    return json({ error: "unknown request" }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: String(e?.message || e) }, 500);
  }
});
