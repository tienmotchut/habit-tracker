import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY, APP_NAME } from "./config.js";

/* =============================================================
   Tiện ích
   ============================================================= */
const $ = (s, r = document) => r.querySelector(s);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseYmd = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const today = () => ymd(new Date());
const addDays = (s, n) => { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); };
const mondayOf = (s) => { const d = parseYmd(s); const k = (d.getDay() + 6) % 7; d.setDate(d.getDate() - k); return ymd(d); };
const tsDay = (ts) => ymd(new Date(ts));
const WD = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];
const fmtDate = (s) => { const d = parseYmd(s); return `${WD[d.getDay()]}, ${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`; };
const fmtTs = (ts) => { const d = new Date(ts); const sameDay = ymd(d) === today(); return `${pad(d.getHours())}:${pad(d.getMinutes())}${sameDay ? "" : ` · ${pad(d.getDate())}/${pad(d.getMonth() + 1)}`}`; };
const PALETTE = ["#1f6fe5", "#e0a100", "#0e9bd8", "#3b4fd6", "#d97706", "#0f766e", "#7c3aed", "#db2777"];
const colorFor = (id = "") => { let h = 0; for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0; return PALETTE[h % PALETTE.length]; };
const initials = (n = "?") => n.trim().split(/\s+/).slice(-2).map((w) => w[0]).join("").toUpperCase() || "?";
const isImage = (name = "") => /\.(png|jpe?g|gif|webp|heic|heif|bmp|avif)$/i.test(name);

let toastTimer;
function toast(msg, err = false) {
  const t = $("#toast");
  t.textContent = msg;
  t.className = "show" + (err ? " err" : "");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = ""), 3200);
}
const errMsg = (e) => e?.message || String(e);

/* =============================================================
   Trạng thái
   ============================================================= */
const configured = !SUPABASE_URL.includes("YOUR-PROJECT") && !SUPABASE_ANON_KEY.includes("YOUR-ANON");
const sb = configured ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

const S = {
  user: null,
  me: null,
  profiles: [],
  topics: [],
  tasks: [],
  checkins: [],
  messages: [],
  tab: ["today", "progress", "manage", "chat"].includes(location.hash.slice(1)) ? location.hash.slice(1) : "today",
  date: today(),
  progTopic: "all",
  progWeeks: 20,
  manageFilter: "all",
  urls: {},
  channel: null,
  notify: localStorage.getItem("notify") === "1",
};

const isOwner = () => S.me?.role === "owner";
const prof = (id) => S.profiles.find((p) => p.id === id);
const nameOf = (id) => prof(id)?.display_name || "Hệ thống";
const members = () => S.profiles.filter((p) => p.approved);
const topicOf = (id) => S.topics.find((t) => t.id === id);
const avatar = (id, cls = "") => {
  const p = prof(id);
  return `<span class="avatar ${cls}" style="background:${colorFor(id || "")}" title="${esc(p?.display_name || "")}">${esc(initials(p?.display_name || "?"))}</span>`;
};

/** Task đã duyệt mà người u phải làm (giao cho cả nhóm hoặc cho u) */
const tasksFor = (uid, topicId = "all") =>
  S.tasks.filter((t) => t.status === "approved" && topicOf(t.topic_id)?.status === "approved" &&
    (!t.assignee_id || t.assignee_id === uid) && (topicId === "all" || t.topic_id === topicId));

const periodOf = (task, day) => (task.frequency === "weekly" ? mondayOf(day) : day);
const checkinOf = (taskId, uid, period) => S.checkins.find((c) => c.task_id === taskId && c.user_id === uid && c.period_start === period);

const pendingItems = () => [
  ...S.profiles.filter((p) => !p.approved).map((p) => ({ type: "member", item: p })),
  ...S.topics.filter((t) => t.status === "pending").map((t) => ({ type: "topic", item: t })),
  ...S.tasks.filter((t) => t.status === "pending").map((t) => ({ type: "task", item: t })),
];

/* =============================================================
   Tải dữ liệu + realtime
   ============================================================= */
async function fetchAll(build) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build().range(from, from + 999);
    if (error) throw error;
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}

async function loadAll() {
  const since = addDays(mondayOf(today()), -7 * 30);
  const [profiles, topics, tasks, checkins, msgs] = await Promise.all([
    fetchAll(() => sb.from("profiles").select("*").order("created_at")),
    fetchAll(() => sb.from("topics").select("*").order("created_at")),
    fetchAll(() => sb.from("tasks").select("*").order("created_at")),
    fetchAll(() => sb.from("checkins").select("*").gte("period_start", since).order("id")),
    sb.from("messages").select("*").order("id", { ascending: false }).limit(300),
  ]);
  if (msgs.error) throw msgs.error;
  Object.assign(S, { profiles, topics, tasks, checkins, messages: msgs.data.reverse() });
  S.me = prof(S.user.id) || S.me;
}

function upsertLocal(table, row) {
  const arr = S[table];
  const i = arr.findIndex((x) => x.id === row.id);
  if (i >= 0) arr[i] = row; else arr.push(row);
}
function removeLocal(table, id) {
  S[table] = S[table].filter((x) => x.id !== id);
}

function subscribe() {
  if (S.channel) sb.removeChannel(S.channel);
  S.channel = sb
    .channel("db-changes")
    .on("postgres_changes", { event: "*", schema: "public" }, (p) => {
      const table = p.table;
      if (!S[table]) return;
      if (p.eventType === "DELETE") removeLocal(table, p.old.id);
      else upsertLocal(table, p.new);
      if (table === "profiles" && p.new?.id === S.user.id) S.me = p.new;
      if (table === "messages" && p.eventType === "INSERT") onNewMessage(p.new);
      scheduleRender();
    })
    .subscribe();
}

let renderTimer;
function scheduleRender() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(render, 80);
}

/* =============================================================
   Khởi động / đăng nhập
   ============================================================= */
async function start() {
  if (!configured) return renderSetupNeeded();
  sb.auth.onAuthStateChange((event, session) => {
    const uid = session?.user?.id || null;
    if (uid === (S.user?.id || null) && event !== "USER_UPDATED") return;
    setTimeout(() => boot(session), 0);
  });
  const { data } = await sb.auth.getSession();
  if (!data.session) boot(null);
}

let waitTimer;
async function boot(session) {
  clearInterval(waitTimer);
  S.user = session?.user || null;
  if (!S.user) {
    if (S.channel) { sb.removeChannel(S.channel); S.channel = null; }
    return renderAuth();
  }
  let me = null;
  for (let i = 0; i < 4 && !me; i++) {
    const { data } = await sb.from("profiles").select("*").eq("id", S.user.id).maybeSingle();
    me = data;
    if (!me) await new Promise((r) => setTimeout(r, 700));
  }
  S.me = me;
  if (!me) return renderBlocked("Tài khoản này không có trong nhóm (có thể đã bị từ chối).");
  if (!me.approved) {
    renderBlocked(`Chào <b>${esc(me.display_name)}</b>! Yêu cầu tham gia của bạn đã được gửi. Chủ nhóm duyệt xong là bạn vào được ngay.`, true);
    waitTimer = setInterval(async () => {
      const { data } = await sb.from("profiles").select("*").eq("id", S.user.id).maybeSingle();
      if (data?.approved) boot(session);
    }, 10000);
    return;
  }
  $("#app").innerHTML = `<div class="boot">Đang tải dữ liệu…</div>`;
  try {
    await loadAll();
  } catch (e) {
    $("#app").innerHTML = `<div class="auth-wrap"><div class="card auth"><h1>Lỗi tải dữ liệu</h1><p class="muted">${esc(errMsg(e))}</p><p class="muted">Kiểm tra bạn đã chạy file <code>supabase/schema.sql</code> chưa.</p></div></div>`;
    return;
  }
  subscribe();
  renderShell();
}

function renderSetupNeeded() {
  $("#app").innerHTML = `
  <div class="auth-wrap"><div class="card auth" style="max-width:560px">
    <div class="brand"><div class="logo">TQ</div>${esc(APP_NAME)}</div>
    <h1>Cần kết nối Supabase</h1>
    <p class="muted">Mở file <code>js/config.js</code> trong repo GitHub và điền <b>SUPABASE_URL</b> và <b>SUPABASE_ANON_KEY</b> của project Supabase. Xem hướng dẫn chi tiết trong <code>README.md</code>.</p>
  </div></div>`;
}

function renderBlocked(html, canWait = false) {
  $("#app").innerHTML = `
  <div class="auth-wrap"><div class="card auth">
    <div class="brand"><div class="logo">TQ</div>${esc(APP_NAME)}</div>
    <h1>${canWait ? "Đang chờ duyệt ⏳" : "Không vào được"}</h1>
    <p class="muted">${html}</p>
    <button class="btn ghost" data-act="logout">Đăng xuất</button>
  </div></div>`;
}

function renderAuth(mode = "login") {
  const signup = mode === "signup";
  $("#app").innerHTML = `
  <div class="auth-wrap"><form class="card auth" id="auth-form">
    <div class="brand"><div class="logo">TQ</div>${esc(APP_NAME)}</div>
    <h1>${signup ? "Tạo tài khoản" : "Đăng nhập"}</h1>
    <p class="muted">${signup ? "Người đăng ký đầu tiên sẽ là chủ nhóm (người duy nhất được duyệt)." : "Cùng nhau giữ thói quen mỗi ngày ✨"}</p>
    ${signup ? `<label class="f">Tên hiển thị</label><input class="in" name="name" required maxlength="40" />` : ""}
    <label class="f">Email</label><input class="in" name="email" type="email" required autocomplete="email" />
    <label class="f">Mật khẩu</label><input class="in" name="password" type="password" required minlength="6" autocomplete="${signup ? "new-password" : "current-password"}" />
    <div class="row" style="margin-top:18px">
      <button class="btn" type="submit">${signup ? "Đăng ký" : "Đăng nhập"}</button>
      <span class="spacer"></span>
      <a href="#" data-act="auth-mode" data-mode="${signup ? "login" : "signup"}">${signup ? "Đã có tài khoản? Đăng nhập" : "Chưa có tài khoản? Đăng ký"}</a>
    </div>
    <p class="muted" id="auth-msg" style="margin-bottom:0"></p>
  </form></div>`;
  $("#auth-form").onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const btn = e.target.querySelector("button[type=submit]");
    btn.disabled = true;
    const msg = $("#auth-msg");
    try {
      if (signup) {
        const { data, error } = await sb.auth.signUp({
          email: f.get("email"),
          password: f.get("password"),
          options: { data: { display_name: f.get("name").trim() }, emailRedirectTo: location.origin + location.pathname },
        });
        if (error) throw error;
        if (!data.session) msg.innerHTML = "✅ Đã đăng ký! Mở email để bấm link xác nhận, rồi quay lại đăng nhập.";
      } else {
        const { error } = await sb.auth.signInWithPassword({ email: f.get("email"), password: f.get("password") });
        if (error) throw error;
      }
    } catch (err) {
      msg.textContent = "⚠️ " + errMsg(err);
    } finally {
      btn.disabled = false;
    }
  };
}

/* =============================================================
   Khung chính
   ============================================================= */
const TABS = [
  ["today", "Hôm nay"],
  ["progress", "Tiến độ"],
  ["manage", "Chủ đề & Task"],
  ["chat", "Chat & Duyệt"],
];

function renderShell() {
  $("#app").innerHTML = `
  <header class="topbar">
    <div class="brand"><div class="logo">TQ</div><span>${esc(APP_NAME)}</span></div>
    <nav class="nav" id="nav"></nav>
    <div class="me">
      <button class="icon-btn" data-act="toggle-notify" id="bell" title="Nhắc nhở trên trình duyệt"></button>
      ${avatar(S.me.id)}
      <div class="who-txt" style="line-height:1.1"><b>${esc(S.me.display_name)}</b><br><span class="muted" style="font-size:12px">${isOwner() ? "Chủ nhóm" : "Thành viên"}</span></div>
      <button class="icon-btn" data-act="logout" title="Đăng xuất">⎋</button>
    </div>
  </header>
  <main id="main"></main>`;
  render();
}

function unreadCount() {
  const seen = Number(localStorage.getItem("seenMsg:" + S.user.id) || 0);
  return S.messages.filter((m) => m.id > seen && m.user_id !== S.user.id).length;
}

function render() {
  if (!$("#main")) return;
  // giữ nội dung đang gõ trong chat
  const chatVal = $("#chat-input")?.value;
  const focused = document.activeElement?.id;
  const scroller = $(".chat-list");
  const nearBottom = scroller ? scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80 : true;

  if (S.tab === "chat" && S.messages.length) localStorage.setItem("seenMsg:" + S.user.id, S.messages[S.messages.length - 1].id);
  const pend = pendingItems().length;
  const unread = unreadCount();
  $("#nav").innerHTML = TABS.map(([k, label]) => {
    let b = "";
    if (k === "chat" && (pend || unread)) b = `<span class="badge" title="${pend} chờ duyệt, ${unread} tin mới">${pend || ""}${unread ? (pend ? " · " : "") + "💬" + unread : ""}</span>`;
    return `<button class="${S.tab === k ? "active" : ""}" data-act="tab" data-tab="${k}">${label}${b}</button>`;
  }).join("");
  $("#bell").textContent = S.notify ? "🔔" : "🔕";

  const main = $("#main");
  if (S.tab === "today") main.innerHTML = viewToday();
  else if (S.tab === "progress") main.innerHTML = viewProgress();
  else if (S.tab === "manage") main.innerHTML = viewManage();
  else main.innerHTML = viewChat();

  if (S.tab === "chat") {
    const inp = $("#chat-input");
    if (chatVal) inp.value = chatVal;
    if (focused === "chat-input" || chatVal === undefined) inp.focus({ preventScroll: true });
    const list = $(".chat-list");
    if (nearBottom || !scroller) list.scrollTop = list.scrollHeight;
  }
  hydrateProofs();
}

/* =============================================================
   Tab: Hôm nay
   ============================================================= */
function viewToday() {
  const day = S.date;
  const uid = S.me.id;
  const mine = tasksFor(uid);
  const doneMine = mine.filter((t) => checkinOf(t.id, uid, periodOf(t, day)));
  const all = members();
  let gExp = 0, gDone = 0;
  for (const m of all) for (const t of tasksFor(m.id)) { gExp++; if (checkinOf(t.id, m.id, periodOf(t, day))) gDone++; }
  const isToday = day === today();

  const byTopic = S.topics.filter((tp) => tp.status === "approved").map((tp) => ({ tp, list: mine.filter((t) => t.topic_id === tp.id) })).filter((x) => x.list.length);

  return `
  <h1 class="page">${isToday ? "Hôm nay" : fmtDate(day)}</h1>
  <p class="sub">${isToday ? fmtDate(day) + " · " : ""}Hoàn thành task bằng cách nộp ảnh hoặc file minh chứng.</p>
  <div class="stats">
    <div class="stat"><b>${doneMine.length}/${mine.length}</b><span>Task của bạn đã xong</span></div>
    <div class="stat y"><b>${streakOf(uid)} 🔥</b><span>Chuỗi ngày liên tiếp</span></div>
    <div class="stat"><b>${gExp ? Math.round((gDone / gExp) * 100) : 0}%</b><span>Cả nhóm hoàn thành</span></div>
    <div class="stat y"><b>${pendingItems().length}</b><span>Đang chờ duyệt</span></div>
  </div>
  <div class="row" style="margin-bottom:16px">
    <div class="date-nav">
      <button class="btn ghost sm" data-act="day" data-d="-1">‹</button>
      <input class="in" type="date" id="day-pick" value="${day}" max="${today()}" />
      <button class="btn ghost sm" data-act="day" data-d="1" ${isToday ? "disabled" : ""}>›</button>
      ${isToday ? "" : `<button class="btn ghost sm" data-act="day" data-d="0">Hôm nay</button>`}
    </div>
    <span class="spacer"></span>
    <button class="btn y" data-act="new-task">＋ Tạo / giao task</button>
  </div>
  ${byTopic.length ? `<div class="grid two">${byTopic.map(({ tp, list }) => `
    <div class="card">
      <div class="topic-head">
        <div class="topic-ico" style="background:${esc(tp.color)}22">${esc(tp.icon)}</div>
        <div><h2>${esc(tp.name)}</h2><span class="muted" style="font-size:13px">${list.filter((t) => checkinOf(t.id, uid, periodOf(t, day))).length}/${list.length} xong</span></div>
      </div>
      ${list.map((t) => taskRow(t, day)).join("")}
    </div>`).join("")}</div>`
    : `<div class="card empty">Chưa có task nào cho bạn. Bấm “Tạo / giao task” để đề xuất nhé!</div>`}`;
}

function taskRow(t, day) {
  const uid = S.me.id;
  const period = periodOf(t, day);
  const c = checkinOf(t.id, uid, period);
  const peers = members().filter((m) => m.id !== uid && (!t.assignee_id || t.assignee_id === m.id))
    .map((m) => ({ m, c: checkinOf(t.id, m.id, period) })).filter((x) => x.c);
  const created = tsDay(t.created_at);
  return `
  <div class="task ${c ? "done" : ""}">
    <div class="check">${c ? "✓" : ""}</div>
    <div class="body">
      <div class="title">${esc(t.title)}</div>
      <div style="margin:3px 0">
        <span class="tag ${t.frequency === "weekly" ? "y" : ""}">${t.frequency === "weekly" ? "Hằng tuần" : "Hằng ngày"}</span>
        ${t.reminder_time ? `<span class="tag">⏰ ${t.reminder_time.slice(0, 5)}</span>` : ""}
        ${t.assignee_id ? `<span class="tag y">👤 ${esc(nameOf(t.assignee_id))}</span>` : ""}
      </div>
      ${t.description ? `<div class="muted" style="font-size:13px">${esc(t.description)}</div>` : ""}
      ${c ? `
        <div class="row" style="margin-top:8px">
          ${proofHtml(c)}
          <div style="flex:1;min-width:120px">${c.note ? `<div style="font-size:13px">“${esc(c.note)}”</div>` : ""}
            <div class="time">${t.frequency === "weekly" ? "Xong ngày " + fmtDate(c.done_on) : "Đã nộp " + fmtTs(c.created_at)}</div></div>
          <button class="btn danger sm" data-act="undo" data-id="${c.id}">Huỷ</button>
        </div>`
      : day < created && t.frequency === "daily" ? `<div class="muted" style="font-size:13px;margin-top:6px">Task chưa tồn tại vào ngày này</div>`
      : `<button class="btn sm" style="margin-top:8px" data-act="submit-proof" data-id="${t.id}">📎 Nộp ảnh / file minh chứng</button>`}
      ${peers.length ? `<div class="peers"><span class="muted" style="font-size:12px;margin-right:4px">Đã xong:</span>${peers.map((x) => `<span data-act="view-proof" data-id="${x.c.id}">${avatar(x.m.id, "sm")}</span>`).join("")}</div>` : ""}
    </div>
  </div>`;
}

function proofHtml(c) {
  if (!c.proof_path) return "";
  if (isImage(c.proof_name || c.proof_path)) return `<img class="proof-thumb" data-proof="${esc(c.proof_path)}" data-act="view-proof" data-id="${c.id}" alt="minh chứng" />`;
  return `<button class="file-chip" data-act="view-proof" data-id="${c.id}">📄 ${esc((c.proof_name || "file").slice(0, 24))}</button>`;
}

async function signedUrl(path) {
  const hit = S.urls[path];
  if (hit && hit.exp > Date.now()) return hit.url;
  const { data, error } = await sb.storage.from("proofs").createSignedUrl(path, 3600);
  if (error) throw error;
  S.urls[path] = { url: data.signedUrl, exp: Date.now() + 3500 * 1000 };
  return data.signedUrl;
}

async function hydrateProofs() {
  const imgs = [...document.querySelectorAll("img[data-proof]")];
  if (!imgs.length) return;
  const need = [...new Set(imgs.map((i) => i.dataset.proof).filter((p) => !(S.urls[p]?.exp > Date.now())))];
  if (need.length) {
    const { data } = await sb.storage.from("proofs").createSignedUrls(need, 3600);
    for (const r of data || []) if (r.signedUrl) S.urls[r.path] = { url: r.signedUrl, exp: Date.now() + 3500 * 1000 };
  }
  for (const img of imgs) if (S.urls[img.dataset.proof]) img.src = S.urls[img.dataset.proof].url;
}

function streakOf(uid) {
  const days = new Set(S.checkins.filter((c) => c.user_id === uid).map((c) => c.done_on));
  let d = today();
  if (!days.has(d)) d = addDays(d, -1);
  let n = 0;
  while (days.has(d)) { n++; d = addDays(d, -1); }
  return n;
}

/* ----- Nộp minh chứng ----- */
async function compressImage(file) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < 1.5e6) return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const cv = document.createElement("canvas");
    cv.width = Math.round(bmp.width * scale);
    cv.height = Math.round(bmp.height * scale);
    cv.getContext("2d").drawImage(bmp, 0, 0, cv.width, cv.height);
    const blob = await new Promise((r) => cv.toBlob(r, "image/jpeg", 0.85));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    return file;
  }
}

function openProofModal(taskId) {
  const t = S.tasks.find((x) => x.id === taskId);
  const day = S.date;
  openModal(`
    <h2>Nộp minh chứng</h2>
    <p class="muted" style="margin-top:0">${esc(t.title)} · ${t.frequency === "weekly" ? "tuần bắt đầu " + fmtDate(mondayOf(day)) : fmtDate(day)}</p>
    <label class="f">Ảnh hoặc file (tối đa 10 MB)</label>
    <input class="in" type="file" id="proof-file" accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.mp3,.m4a,.mp4,.mov" />
    <div id="proof-prev" style="margin-top:10px"></div>
    <label class="f">Ghi chú (không bắt buộc)</label>
    <textarea class="in" id="proof-note" maxlength="500" placeholder="VD: chạy 5km sáng nay"></textarea>
    <div class="foot">
      <button class="btn ghost" data-act="close-modal">Huỷ</button>
      <button class="btn y" id="proof-go">Hoàn thành ✓</button>
    </div>`);
  $("#proof-file").onchange = (e) => {
    const f = e.target.files[0];
    $("#proof-prev").innerHTML = f && f.type.startsWith("image/") ? `<img class="preview" src="${URL.createObjectURL(f)}" />` : f ? `<span class="file-chip">📄 ${esc(f.name)}</span>` : "";
  };
  $("#proof-go").onclick = async (e) => {
    let file = $("#proof-file").files[0];
    if (!file) return toast("Chọn ảnh hoặc file minh chứng trước nhé", true);
    e.target.disabled = true;
    e.target.textContent = "Đang tải lên…";
    try {
      file = await compressImage(file);
      if (file.size > 10 * 1024 * 1024) throw new Error("File lớn hơn 10 MB");
      const period = periodOf(t, day);
      const safe = file.name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w.\-]+/g, "_").slice(-60);
      const path = `${S.me.id}/${period}/${t.id}-${Date.now()}-${safe}`;
      const up = await sb.storage.from("proofs").upload(path, file, { contentType: file.type || "application/octet-stream" });
      if (up.error) throw up.error;
      const { data, error } = await sb.from("checkins").insert({
        task_id: t.id, user_id: S.me.id, period_start: period, done_on: day,
        note: $("#proof-note").value.trim() || null, proof_path: path, proof_name: file.name,
      }).select().single();
      if (error) { await sb.storage.from("proofs").remove([path]); throw error; }
      upsertLocal("checkins", data);
      closeModal();
      toast("Tuyệt! Đã hoàn thành 🎉");
      render();
    } catch (err) {
      toast(errMsg(err), true);
      e.target.disabled = false;
      e.target.textContent = "Hoàn thành ✓";
    }
  };
}

async function viewProof(id) {
  const c = S.checkins.find((x) => x.id === id);
  if (!c) return;
  const t = S.tasks.find((x) => x.id === c.task_id);
  let body = `<p class="muted">Không có file.</p>`;
  if (c.proof_path) {
    try {
      const url = await signedUrl(c.proof_path);
      body = isImage(c.proof_name || c.proof_path)
        ? `<a href="${esc(url)}" target="_blank" rel="noopener"><img class="preview" src="${esc(url)}" /></a>`
        : `<a class="btn" href="${esc(url)}" target="_blank" rel="noopener">📄 Mở ${esc(c.proof_name || "file")}</a>`;
    } catch (e) { body = `<p class="muted">${esc(errMsg(e))}</p>`; }
  }
  openModal(`
    <div class="row">${avatar(c.user_id)}<div><h2>${esc(nameOf(c.user_id))}</h2><span class="muted">${esc(t?.title || "")} · ${fmtDate(c.done_on)}</span></div></div>
    <div style="margin-top:14px">${body}</div>
    ${c.note ? `<p>“${esc(c.note)}”</p>` : ""}
    <div class="foot"><button class="btn ghost" data-act="close-modal">Đóng</button></div>`);
}

async function undoCheckin(id) {
  const c = S.checkins.find((x) => x.id === id);
  if (!c || !confirm("Huỷ hoàn thành task này? File minh chứng sẽ bị xoá.")) return;
  const { error } = await sb.from("checkins").delete().eq("id", id);
  if (error) return toast(errMsg(error), true);
  if (c.proof_path) await sb.storage.from("proofs").remove([c.proof_path]);
  removeLocal("checkins", id);
  render();
}

/* =============================================================
   Tab: Tiến độ (heatmap)
   ============================================================= */
function dayStats(uid, day, topicId) {
  const p = prof(uid);
  if (p && day < tsDay(p.created_at)) return null;
  const list = tasksFor(uid, topicId);
  const ids = new Set(list.map((t) => t.id));
  const expected = list.filter((t) => t.frequency === "daily" && tsDay(t.created_at) <= day).length;
  const done = S.checkins.filter((c) => c.user_id === uid && c.done_on === day && ids.has(c.task_id)).length;
  return { expected, done };
}

function levelOf(s) {
  if (!s || !s.done) return 0;
  const r = s.expected ? s.done / s.expected : 1;
  return r >= 1 ? 4 : r >= 0.67 ? 3 : r >= 0.34 ? 2 : 1;
}

function weekRate(uid, topicId) {
  const mon = mondayOf(today());
  let exp = 0, done = 0;
  for (const t of tasksFor(uid, topicId)) {
    if (t.frequency === "weekly") {
      exp++; if (checkinOf(t.id, uid, mon)) done++;
    } else {
      for (let d = mon; d <= today(); d = addDays(d, 1)) {
        if (tsDay(t.created_at) > d) continue;
        exp++; if (checkinOf(t.id, uid, d)) done++;
      }
    }
  }
  return exp ? Math.round((done / exp) * 100) : 0;
}

function heatmap(uid, topicId, weeks) {
  const start = addDays(mondayOf(today()), -7 * (weeks - 1));
  const end = today();
  let cells = "", total = 0;
  for (let w = 0; w < weeks; w++) {
    for (let k = 0; k < 7; k++) {
      const d = addDays(start, w * 7 + k);
      if (d > end) { cells += `<i class="out"></i>`; continue; }
      const s = dayStats(uid, d, topicId);
      const lv = levelOf(s);
      if (s) total += s.done;
      const tip = `${fmtDate(d)}: ${s ? `${s.done}/${s.expected} task` : "chưa tham gia"}`;
      cells += `<i class="l${lv}${d === end ? " today" : ""}" title="${esc(tip)}"></i>`;
    }
  }
  return { html: `<div class="row" style="align-items:flex-start;flex-wrap:nowrap"><div class="hm-days"><span>T2</span><span></span><span>T4</span><span></span><span>T6</span><span></span><span>CN</span></div><div class="hm-wrap"><div class="hm">${cells}</div></div></div>`, total };
}

function bestStreak(uid) {
  const days = [...new Set(S.checkins.filter((c) => c.user_id === uid).map((c) => c.done_on))].sort();
  let best = 0, cur = 0, prev = null;
  for (const d of days) { cur = prev && addDays(prev, 1) === d ? cur + 1 : 1; best = Math.max(best, cur); prev = d; }
  return best;
}

function viewProgress() {
  const tp = S.progTopic;
  const ms = members();
  const ranked = ms.map((m) => ({ m, r: weekRate(m.id, tp) })).sort((a, b) => b.r - a.r);
  const topics = S.topics.filter((t) => t.status === "approved");
  return `
  <h1 class="page">Tiến độ nhóm</h1>
  <p class="sub">Mỗi ô là một ngày. Càng đậm càng làm được nhiều task, ô vàng là hoàn thành 100%.</p>
  <div class="row" style="margin-bottom:16px">
    <div class="pills">
      <button class="${tp === "all" ? "active" : ""}" data-act="prog-topic" data-id="all">Tất cả</button>
      ${topics.map((t) => `<button class="${tp === t.id ? "active" : ""}" data-act="prog-topic" data-id="${t.id}">${esc(t.icon)} ${esc(t.name)}</button>`).join("")}
    </div>
    <span class="spacer"></span>
    <div class="pills">
      ${[12, 20, 26].map((w) => `<button class="${S.progWeeks === w ? "active" : ""}" data-act="prog-weeks" data-w="${w}">${w} tuần</button>`).join("")}
    </div>
  </div>
  <div class="card" style="margin-bottom:16px">
    <h2 style="margin-bottom:6px">🏆 Tuần này</h2>
    ${ranked.map(({ m, r }, i) => `
      <div class="rank"><span class="n">${i === 0 && r > 0 ? "🥇" : i === 1 && r > 0 ? "🥈" : i === 2 && r > 0 ? "🥉" : i + 1}</span>${avatar(m.id)}
        <b>${esc(m.display_name)}${m.id === S.me.id ? " (bạn)" : ""}</b>
        <div class="bar"><div style="width:${r}%"></div></div><b style="text-align:right">${r}%</b></div>`).join("")}
  </div>
  ${ms.map((m) => {
    const h = heatmap(m.id, tp, S.progWeeks);
    return `
    <div class="card member-card">
      <div class="row" style="margin-bottom:12px">
        ${avatar(m.id)}<h2>${esc(m.display_name)}</h2>
        <span class="spacer"></span>
        <span class="tag y">🔥 ${streakOf(m.id)} ngày</span>
        <span class="tag">Kỷ lục ${bestStreak(m.id)} ngày</span>
        <span class="tag">${h.total} lần hoàn thành</span>
      </div>
      ${h.html}
    </div>`;
  }).join("")}
  <div class="legend">Ít <i style="background:var(--h0)"></i><i style="background:var(--h1)"></i><i style="background:var(--h2)"></i><i style="background:var(--h3)"></i><i style="background:var(--h4)"></i> 100%</div>`;
}

/* =============================================================
   Tab: Chủ đề & Task
   ============================================================= */
const STATUS_TAG = { pending: `<span class="tag p">Chờ duyệt</span>`, rejected: `<span class="tag r">Bị từ chối</span>`, approved: "" };

function approveBtns(type, id) {
  if (!isOwner()) return "";
  return `<button class="btn ok sm" data-act="approve" data-type="${type}" data-id="${id}">Duyệt</button>
          <button class="btn danger sm" data-act="reject" data-type="${type}" data-id="${id}">Từ chối</button>`;
}

function viewManage() {
  const f = S.manageFilter;
  const uid = S.me.id;
  const taskOk = (t) => f === "all" || (f === "pending" && t.status === "pending") || (f === "mine" && (t.assignee_id === uid || t.created_by === uid));
  const topics = S.topics.filter((tp) => f === "all" || (f === "pending" && (tp.status === "pending" || S.tasks.some((t) => t.topic_id === tp.id && t.status === "pending"))) || (f === "mine" && S.tasks.some((t) => t.topic_id === tp.id && taskOk(t))));
  const canEdit = (x) => isOwner() || x.created_by === uid;
  return `
  <h1 class="page">Chủ đề & Task</h1>
  <p class="sub">${isOwner() ? "Bạn là chủ nhóm: mọi thứ bạn tạo được duyệt ngay, đề xuất của thành viên chờ bạn duyệt." : "Bạn có thể đề xuất chủ đề, tạo và giao task cho người khác. Chủ nhóm sẽ duyệt."}</p>
  <div class="row" style="margin-bottom:16px">
    <div class="pills">
      <button class="${f === "all" ? "active" : ""}" data-act="mfilter" data-f="all">Tất cả</button>
      <button class="${f === "pending" ? "active" : ""}" data-act="mfilter" data-f="pending">Chờ duyệt (${S.topics.filter((t) => t.status === "pending").length + S.tasks.filter((t) => t.status === "pending").length})</button>
      <button class="${f === "mine" ? "active" : ""}" data-act="mfilter" data-f="mine">Của tôi</button>
    </div>
    <span class="spacer"></span>
    <button class="btn ghost" data-act="ics-all">📅 Thêm nhắc nhở vào lịch</button>
    <button class="btn ghost" data-act="new-topic">＋ ${isOwner() ? "Chủ đề" : "Đề xuất chủ đề"}</button>
    <button class="btn y" data-act="new-task">＋ Task</button>
  </div>
  <div class="grid two">
  ${topics.map((tp) => {
    const list = S.tasks.filter((t) => t.topic_id === tp.id && taskOk(t));
    return `
    <div class="card ${tp.status === "rejected" ? "faded" : ""}">
      <div class="topic-head">
        <div class="topic-ico" style="background:${esc(tp.color)}22">${esc(tp.icon)}</div>
        <div style="flex:1 1 150px"><h2>${esc(tp.name)} ${STATUS_TAG[tp.status]}</h2>
          ${tp.created_by ? `<span class="muted" style="font-size:12px">bởi ${esc(nameOf(tp.created_by))}</span>` : ""}</div>
        <div class="row acts">${tp.status === "pending" ? approveBtns("topic", tp.id) : ""}
        ${canEdit(tp) ? `<button class="icon-btn" data-act="edit-topic" data-id="${tp.id}" title="Sửa">✏️</button>` : ""}
        ${isOwner() || (tp.created_by === uid && tp.status === "pending") ? `<button class="icon-btn" data-act="del-topic" data-id="${tp.id}" title="Xoá">🗑️</button>` : ""}</div>
      </div>
      ${list.map((t) => `
        <div class="task-line ${t.status === "rejected" ? "faded" : ""}">
          <div style="flex:1 1 200px;min-width:0">
            <b>${esc(t.title)}</b> ${STATUS_TAG[t.status]}<br>
            <span class="tag ${t.frequency === "weekly" ? "y" : ""}">${t.frequency === "weekly" ? "Hằng tuần" : "Hằng ngày"}</span>
            ${t.reminder_time ? `<span class="tag">⏰ ${t.reminder_time.slice(0, 5)}</span>` : ""}
            <span class="tag y">👤 ${t.assignee_id ? esc(nameOf(t.assignee_id)) : "Cả nhóm"}</span>
            ${t.created_by ? `<span class="muted" style="font-size:12px">· tạo bởi ${esc(nameOf(t.created_by))}</span>` : ""}
          </div>
          <div class="row acts">${t.status === "pending" ? approveBtns("task", t.id) : ""}
          ${t.reminder_time && t.status === "approved" ? `<button class="icon-btn" data-act="ics" data-id="${t.id}" title="Thêm nhắc nhở vào lịch">📅</button>` : ""}
          ${canEdit(t) ? `<button class="icon-btn" data-act="edit-task" data-id="${t.id}" title="Sửa">✏️</button>` : ""}
          ${isOwner() || (t.created_by === uid && t.status === "pending") ? `<button class="icon-btn" data-act="del-task" data-id="${t.id}" title="Xoá">🗑️</button>` : ""}</div>
        </div>`).join("") || `<div class="muted" style="font-size:14px">Chưa có task.</div>`}
      ${tp.status !== "rejected" ? `<button class="btn ghost sm" style="margin-top:10px" data-act="new-task" data-topic="${tp.id}">＋ Task trong chủ đề này</button>` : ""}
    </div>`;
  }).join("") || `<div class="card empty">Không có gì ở đây.</div>`}
  </div>
  ${isOwner() ? membersCard() : ""}`;
}

function membersCard() {
  return `
  <div class="card" style="margin-top:16px">
    <h2 style="margin-bottom:8px">👥 Thành viên</h2>
    ${S.profiles.map((p) => `
      <div class="task-line">
        ${avatar(p.id)}<div style="flex:1"><b>${esc(p.display_name)}</b> ${p.role === "owner" ? `<span class="tag y">Chủ nhóm</span>` : ""} ${p.approved ? "" : `<span class="tag p">Chờ duyệt</span>`}</div>
        ${!p.approved ? approveBtns("member", p.id) : p.role !== "owner" ? `<button class="btn danger sm" data-act="reject" data-type="member" data-id="${p.id}">Xoá khỏi nhóm</button>` : ""}
      </div>`).join("")}
  </div>`;
}

function openTopicModal(id) {
  const tp = id ? S.topics.find((t) => t.id === id) : null;
  const icons = ["💪", "💧", "🀄", "💼", "👨‍👩‍👧", "📚", "🧘", "🏃", "🥗", "😴", "💰", "🎨", "🎵", "🧹", "🌱", "✍️"];
  openModal(`
    <h2>${tp ? "Sửa chủ đề" : isOwner() ? "Thêm chủ đề" : "Đề xuất chủ đề"}</h2>
    ${!isOwner() ? `<p class="muted" style="margin-top:0">Chủ nhóm sẽ duyệt trước khi chủ đề xuất hiện.</p>` : ""}
    <label class="f">Tên chủ đề</label><input class="in" id="tp-name" maxlength="60" value="${esc(tp?.name || "")}" />
    <label class="f">Biểu tượng</label>
    <div class="row">${icons.map((i) => `<button class="icon-btn" style="font-size:22px" data-act="pick-icon" data-i="${i}">${i}</button>`).join("")}</div>
    <input class="in" id="tp-icon" maxlength="8" value="${esc(tp?.icon || "⭐")}" style="margin-top:8px;width:90px" />
    <label class="f">Màu</label><input type="color" id="tp-color" value="${esc(tp?.color || "#1f6fe5")}" />
    <div class="foot">
      <button class="btn ghost" data-act="close-modal">Huỷ</button>
      <button class="btn y" id="tp-save">${isOwner() ? "Lưu" : "Gửi đề xuất"}</button>
    </div>`);
  $("#tp-save").onclick = async () => {
    const row = { name: $("#tp-name").value.trim(), icon: $("#tp-icon").value.trim() || "⭐", color: $("#tp-color").value };
    if (!row.name) return toast("Nhập tên chủ đề", true);
    const q = tp ? sb.from("topics").update(row).eq("id", tp.id) : sb.from("topics").insert(row);
    const { data, error } = await q.select().single();
    if (error) return toast(errMsg(error), true);
    upsertLocal("topics", data);
    closeModal();
    toast(data.status === "pending" ? "Đã gửi đề xuất, chờ chủ nhóm duyệt" : "Đã lưu");
    render();
  };
}

function openTaskModal(id, topicId) {
  const t = id ? S.tasks.find((x) => x.id === id) : null;
  const topics = S.topics.filter((tp) => tp.status === "approved" || (tp.status === "pending" && tp.created_by === S.me.id) || tp.id === t?.topic_id);
  const sel = t?.topic_id || topicId || topics[0]?.id;
  const freq = t?.frequency || "daily";
  openModal(`
    <h2>${t ? "Sửa task" : "Tạo task"}</h2>
    ${!isOwner() ? `<p class="muted" style="margin-top:0">Task ${t ? "sau khi sửa" : "mới"} sẽ chờ chủ nhóm duyệt.</p>` : ""}
    <label class="f">Tên task</label><input class="in" id="tk-title" maxlength="100" value="${esc(t?.title || "")}" placeholder="VD: Chạy bộ 3km" />
    <label class="f">Mô tả / cách chứng minh</label><textarea class="in" id="tk-desc" maxlength="500" placeholder="VD: Chụp ảnh màn hình app chạy bộ">${esc(t?.description || "")}</textarea>
    <div class="row" style="align-items:flex-start">
      <div style="flex:1;min-width:180px"><label class="f">Chủ đề</label>
        <select class="in" id="tk-topic">${topics.map((tp) => `<option value="${tp.id}" ${tp.id === sel ? "selected" : ""}>${esc(tp.icon)} ${esc(tp.name)}${tp.status === "pending" ? " (chờ duyệt)" : ""}</option>`).join("")}</select></div>
      <div style="flex:1;min-width:180px"><label class="f">Giao cho</label>
        <select class="in" id="tk-assignee"><option value="">👥 Cả nhóm</option>${members().map((m) => `<option value="${m.id}" ${t?.assignee_id === m.id ? "selected" : ""}>${esc(m.display_name)}${m.id === S.me.id ? " (tôi)" : ""}</option>`).join("")}</select></div>
    </div>
    <label class="f">Lặp lại</label>
    <div class="seg">
      <label><input type="radio" name="tk-freq" value="daily" ${freq === "daily" ? "checked" : ""}><span>Hằng ngày (daily)</span></label>
      <label><input type="radio" name="tk-freq" value="weekly" ${freq === "weekly" ? "checked" : ""}><span>Hằng tuần (weekly)</span></label>
    </div>
    <label class="f">Nhắc nhở lúc</label>
    <div class="row"><input class="in" type="time" id="tk-rem" value="${esc(t?.reminder_time?.slice(0, 5) || "")}" style="width:140px" />
      <span class="muted" style="font-size:13px">Để trống nếu không cần nhắc</span></div>
    <div class="foot">
      ${t && t.reminder_time ? `<button class="btn ghost" data-act="ics" data-id="${t.id}">📅 Thêm vào lịch</button>` : ""}
      <span class="spacer"></span>
      <button class="btn ghost" data-act="close-modal">Huỷ</button>
      <button class="btn y" id="tk-save">${isOwner() ? "Lưu" : "Gửi duyệt"}</button>
    </div>`);
  $("#tk-save").onclick = async () => {
    const row = {
      title: $("#tk-title").value.trim(),
      description: $("#tk-desc").value.trim() || null,
      topic_id: $("#tk-topic").value,
      assignee_id: $("#tk-assignee").value || null,
      frequency: document.querySelector("input[name=tk-freq]:checked").value,
      reminder_time: $("#tk-rem").value || null,
    };
    if (!row.title) return toast("Nhập tên task", true);
    if (!row.topic_id) return toast("Chọn chủ đề", true);
    const q = t ? sb.from("tasks").update(row).eq("id", t.id) : sb.from("tasks").insert(row);
    const { data, error } = await q.select().single();
    if (error) return toast(errMsg(error), true);
    upsertLocal("tasks", data);
    closeModal();
    toast(data.status === "pending" ? "Đã gửi, chờ chủ nhóm duyệt" : "Đã lưu");
    render();
  };
}

async function setStatus(type, id, approve) {
  if (type === "member") {
    const p = prof(id);
    if (approve) {
      const { error } = await sb.from("profiles").update({ approved: true }).eq("id", id);
      if (error) return toast(errMsg(error), true);
      upsertLocal("profiles", { ...p, approved: true });
    } else {
      if (!confirm(`Xoá ${p?.display_name} khỏi nhóm?`)) return;
      const { error } = await sb.from("profiles").delete().eq("id", id);
      if (error) return toast(errMsg(error), true);
      removeLocal("profiles", id);
    }
  } else {
    const table = type === "topic" ? "topics" : "tasks";
    const { data, error } = await sb.from(table).update({ status: approve ? "approved" : "rejected" }).eq("id", id).select().single();
    if (error) return toast(errMsg(error), true);
    upsertLocal(table, data);
  }
  toast(approve ? "Đã duyệt ✅" : "Đã từ chối");
  render();
}

async function del(table, id) {
  if (!confirm(table === "topics" ? "Xoá chủ đề này và toàn bộ task trong đó?" : "Xoá task này?")) return;
  const { error } = await sb.from(table).delete().eq("id", id);
  if (error) return toast(errMsg(error), true);
  removeLocal(table, id);
  if (table === "topics") S.tasks = S.tasks.filter((t) => t.topic_id !== id);
  render();
}

/* =============================================================
   Tab: Chat & Duyệt
   ============================================================= */
function refInfo(type, id) {
  if (type === "member") { const p = prof(id); return p ? { status: p.approved ? "approved" : "pending", label: p.display_name } : null; }
  const x = type === "topic" ? topicOf(id) : S.tasks.find((t) => t.id === id);
  return x ? { status: x.status, label: x.name || x.title, x } : null;
}

function msgHtml(m) {
  const mine = m.user_id === S.user.id;
  if (m.kind === "chat") {
    return `<div class="msg ${mine ? "mine" : ""}">${avatar(m.user_id, "sm")}
      <div><div class="who">${mine ? "" : esc(nameOf(m.user_id)) + " · "}${fmtTs(m.created_at)}</div><div class="bubble">${esc(m.content)}</div></div></div>`;
  }
  if (m.kind === "system") {
    return `<div class="sysmsg"><div class="box plain">${esc(m.content)} <span class="time">${fmtTs(m.created_at)}</span></div></div>`;
  }
  const ref = m.ref_type ? refInfo(m.ref_type, m.ref_id) : null;
  const status = ref ? ref.status : "deleted";
  const tag = status === "pending" ? `<span class="tag p">Chờ duyệt</span>` : status === "approved" ? `<span class="tag" style="background:#dcfce7;color:#15803d">Đã duyệt</span>` : status === "rejected" ? `<span class="tag r">Bị từ chối</span>` : `<span class="tag">Đã xoá</span>`;
  const extra = m.ref_type === "task" && ref?.x ? `<div class="muted" style="font-size:13px;margin-top:4px">${esc(topicOf(ref.x.topic_id)?.icon || "")} ${esc(topicOf(ref.x.topic_id)?.name || "")} · ${ref.x.frequency === "weekly" ? "hằng tuần" : "hằng ngày"}${ref.x.reminder_time ? " · ⏰ " + ref.x.reminder_time.slice(0, 5) : ""}</div>` : "";
  return `<div class="sysmsg"><div class="box">
    ${m.kind === "join" ? "🙋" : "💡"} <b>${esc(nameOf(m.user_id))}</b> ${esc(m.content)} <span class="time">${fmtTs(m.created_at)}</span>
    ${extra}
    <div class="acts">${tag}${status === "pending" ? approveBtns(m.ref_type, m.ref_id) : ""}
      ${m.ref_type === "task" && ref?.x && (isOwner() || ref.x.created_by === S.me.id) ? `<button class="btn ghost sm" data-act="edit-task" data-id="${m.ref_id}">Xem / sửa</button>` : ""}</div>
  </div></div>`;
}

function viewChat() {
  const pend = pendingItems();
  return `
  <h1 class="page">Chat & Duyệt</h1>
  <p class="sub">Trò chuyện với cả nhóm. Mọi đề xuất chủ đề, task và yêu cầu tham gia đều hiện ở đây${isOwner() ? " để bạn duyệt" : ""}.</p>
  <div class="chat-layout">
    <div class="card chat">
      <div class="chat-list">${S.messages.map(msgHtml).join("") || `<div class="empty">Chưa có tin nhắn nào. Chào cả nhóm đi! 👋</div>`}</div>
      <form class="chat-form" id="chat-form">
        <input class="in" id="chat-input" placeholder="Nhắn cho cả nhóm…" maxlength="1000" autocomplete="off" />
        <button class="btn" type="submit">Gửi</button>
      </form>
    </div>
    <div>
      <div class="card">
        <h2 style="margin-bottom:6px">⏳ Đang chờ duyệt <span class="badge">${pend.length}</span></h2>
        ${pend.map(({ type, item }) => `
          <div class="pending-item">
            <div><span class="tag ${type === "member" ? "y" : ""}">${type === "member" ? "Thành viên" : type === "topic" ? "Chủ đề" : "Task"}</span>
              <b>${esc(type === "member" ? item.display_name : type === "topic" ? item.icon + " " + item.name : item.title)}</b></div>
            <div class="muted" style="font-size:12px;margin:3px 0 6px">${type === "member" ? "xin tham gia" : "đề xuất bởi " + esc(nameOf(item.created_by))}${type === "task" ? " · " + esc(topicOf(item.topic_id)?.name || "") + (item.assignee_id ? " · giao cho " + esc(nameOf(item.assignee_id)) : "") : ""}</div>
            <div class="row">${isOwner() ? approveBtns(type, item.id) : `<span class="muted" style="font-size:13px">Chờ chủ nhóm duyệt</span>`}
              ${type === "task" && (isOwner() || item.created_by === S.me.id) ? `<button class="btn ghost sm" data-act="edit-task" data-id="${item.id}">Xem</button>` : ""}</div>
          </div>`).join("") || `<p class="muted">Không có gì cần duyệt 🎉</p>`}
      </div>
      <div class="card" style="margin-top:16px">
        <h2 style="margin-bottom:8px">👥 Hôm nay</h2>
        ${members().map((m) => {
          const list = tasksFor(m.id);
          const done = list.filter((t) => checkinOf(t.id, m.id, periodOf(t, today()))).length;
          const pct = list.length ? Math.round((done / list.length) * 100) : 0;
          return `<div class="row" style="margin:8px 0;flex-wrap:nowrap">${avatar(m.id, "sm")}<span style="width:90px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(m.display_name)}</span><div class="bar"><div style="width:${pct}%"></div></div><b style="font-size:13px">${done}/${list.length}</b></div>`;
        }).join("")}
      </div>
    </div>
  </div>`;
}

async function sendChat(text) {
  const { data, error } = await sb.from("messages").insert({ user_id: S.me.id, content: text, kind: "chat" }).select().single();
  if (error) return toast(errMsg(error), true);
  upsertLocal("messages", data);
  render();
}

function onNewMessage(m) {
  if (m.user_id === S.user.id) return;
  if (S.notify && document.hidden && "Notification" in window && Notification.permission === "granted") {
    const who = nameOf(m.user_id);
    new Notification(m.kind === "chat" ? `💬 ${who}` : "💡 Cần duyệt", { body: m.kind === "chat" ? m.content : `${who} ${m.content}`, tag: "msg" });
  }
}

/* =============================================================
   Nhắc nhở
   ============================================================= */
async function toggleNotify() {
  if (!S.notify) {
    if (!("Notification" in window)) return toast("Trình duyệt này không hỗ trợ thông báo. Dùng nút 📅 để thêm vào lịch điện thoại.", true);
    const perm = await Notification.requestPermission();
    if (perm !== "granted") return toast("Bạn chưa cho phép thông báo", true);
    S.notify = true;
    toast("Đã bật nhắc nhở (khi web đang mở). Muốn nhắc cả khi tắt web, dùng 📅 Thêm vào lịch.");
  } else {
    S.notify = false;
    toast("Đã tắt nhắc nhở");
  }
  localStorage.setItem("notify", S.notify ? "1" : "0");
  render();
}

function checkReminders() {
  if (!S.me?.approved || !S.notify) return;
  const now = new Date();
  const hm = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const d = today();
  for (const t of tasksFor(S.me.id)) {
    if (!t.reminder_time) continue;
    const rt = t.reminder_time.slice(0, 5);
    if (rt > hm) continue;
    const [h, m] = rt.split(":").map(Number);
    if (now.getHours() * 60 + now.getMinutes() - (h * 60 + m) > 60) continue;
    if (checkinOf(t.id, S.me.id, periodOf(t, d))) continue;
    const key = `rem:${t.id}:${d}`;
    if (localStorage.getItem(key)) continue;
    localStorage.setItem(key, "1");
    toast(`⏰ Đến giờ: ${t.title}`);
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification(`⏰ ${t.title}`, { body: t.description || "Đừng quên nộp minh chứng nhé!", tag: t.id });
    }
  }
}

function icsEvent(t) {
  const [h, m] = t.reminder_time.slice(0, 5).split(":").map(Number);
  const s = new Date();
  s.setHours(h, m, 0, 0);
  const e = new Date(s.getTime() + 15 * 60000);
  const f = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  const clean = (x) => String(x || "").replace(/[\\;,]/g, (c) => "\\" + c).replace(/\n/g, "\\n");
  const topic = topicOf(t.topic_id);
  return [
    "BEGIN:VEVENT",
    `UID:${t.id}@habit-tracker`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${f(s)}`,
    `DTEND:${f(e)}`,
    `RRULE:FREQ=${t.frequency === "weekly" ? "WEEKLY" : "DAILY"}`,
    `SUMMARY:${clean((topic?.icon || "") + " " + t.title)}`,
    `DESCRIPTION:${clean((t.description || "") + "\nNộp minh chứng tại: " + location.origin + location.pathname)}`,
    "BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${clean(t.title)}`, "TRIGGER:PT0M", "END:VALARM",
    "END:VEVENT",
  ].join("\r\n");
}

function downloadIcs(list, name) {
  const withTime = list.filter((t) => t.reminder_time);
  if (!withTime.length) return toast("Chưa có task nào đặt giờ nhắc", true);
  const body = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//habit-tracker//VI", "CALSCALE:GREGORIAN", ...withTime.map(icsEvent), "END:VCALENDAR"].join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([body], { type: "text/calendar;charset=utf-8" }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast("Mở file .ics vừa tải để thêm nhắc nhở vào lịch");
}

/* =============================================================
   Modal + sự kiện
   ============================================================= */
function openModal(html) {
  $("#modal-root").innerHTML = `<div class="modal-bg" data-act="modal-bg"><div class="modal">${html}</div></div>`;
  $("#modal-root input, #modal-root textarea")?.focus();
}
function closeModal() { $("#modal-root").innerHTML = ""; }

const actions = {
  "auth-mode": (d, el, e) => { e.preventDefault(); renderAuth(d.mode); },
  logout: async () => { await sb.auth.signOut(); },
  tab: (d) => { S.tab = d.tab; history.replaceState(null, "", "#" + d.tab); render(); window.scrollTo(0, 0); },
  day: (d) => { S.date = d.d === "0" ? today() : addDays(S.date, Number(d.d)); if (S.date > today()) S.date = today(); render(); },
  "submit-proof": (d) => openProofModal(d.id),
  "view-proof": (d) => viewProof(d.id),
  undo: (d) => undoCheckin(d.id),
  "prog-topic": (d) => { S.progTopic = d.id; render(); },
  "prog-weeks": (d) => { S.progWeeks = Number(d.w); render(); },
  mfilter: (d) => { S.manageFilter = d.f; render(); },
  "new-topic": () => openTopicModal(),
  "edit-topic": (d) => openTopicModal(d.id),
  "del-topic": (d) => del("topics", d.id),
  "new-task": (d) => openTaskModal(null, d.topic),
  "edit-task": (d) => openTaskModal(d.id),
  "del-task": (d) => del("tasks", d.id),
  approve: (d) => setStatus(d.type, d.id, true),
  reject: (d) => setStatus(d.type, d.id, false),
  "pick-icon": (d, el, e) => { e.preventDefault(); $("#tp-icon").value = d.i; },
  ics: (d) => { const t = S.tasks.find((x) => x.id === d.id); downloadIcs([t], `nhac-${t.title.normalize("NFD").replace(/[^\w]+/g, "-").slice(0, 30)}.ics`); },
  "ics-all": () => downloadIcs(tasksFor(S.me.id), "nhac-nho-thoi-quen.ics"),
  "toggle-notify": () => toggleNotify(),
  "close-modal": () => closeModal(),
  "modal-bg": (d, el, e) => { if (e.target === el) closeModal(); },
};

document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-act]");
  if (!el) return;
  // modal-bg chỉ đóng khi bấm đúng nền
  if (el.dataset.act === "modal-bg" && e.target !== el) return;
  const fn = actions[el.dataset.act];
  if (fn) fn(el.dataset, el, e);
});

document.addEventListener("change", (e) => {
  if (e.target.id === "day-pick" && e.target.value) { S.date = e.target.value > today() ? today() : e.target.value; render(); }
});

document.addEventListener("submit", (e) => {
  if (e.target.id !== "chat-form") return;
  e.preventDefault();
  const inp = $("#chat-input");
  const text = inp.value.trim();
  if (!text) return;
  inp.value = "";
  sendChat(text);
});

document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });

// Đổi ngày lúc nửa đêm / quay lại tab
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && S.me?.approved && $("#main")) {
    render();
  }
});

setInterval(checkReminders, 30000);
setTimeout(checkReminders, 3000);

start();
