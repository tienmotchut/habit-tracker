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
const MO = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const fmtDate = (s) => { const d = parseYmd(s); return `${WD[d.getDay()]}, ${MO[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`; };
const fmtTs = (ts) => { const d = new Date(ts); const sameDay = ymd(d) === today(); return `${pad(d.getHours())}:${pad(d.getMinutes())}${sameDay ? "" : ` · ${pad(d.getDate())}/${pad(d.getMonth() + 1)}`}`; };
const PALETTE = ["#2f8f3f", "#e0a100", "#3aa676", "#6b8e23", "#d97706", "#0f766e", "#c2410c", "#4d7c0f"];
const colorFor = (id = "") => { let h = 0; for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0; return PALETTE[h % PALETTE.length]; };
const initials = (n = "?") => n.trim().split(/\s+/).slice(-2).map((w) => w[0]).join("").toUpperCase() || "?";
/** escape + làm dịu emoji trong chat */
const soft = (v) => esc(v).replace(/(\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic}|\p{Emoji_Modifier})*)/gu, '<span class="emo">$1</span>');
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
const nameOf = (id) => prof(id)?.display_name || "System";
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
  if (!me) return renderBlocked("This account is not part of the group (it may have been declined).");
  if (!me.approved) {
    renderBlocked(`Hi <b>${esc(me.display_name)}</b>! Your request to join has been sent. You will get in as soon as the owner approves it.`, true);
    waitTimer = setInterval(async () => {
      const { data } = await sb.from("profiles").select("*").eq("id", S.user.id).maybeSingle();
      if (data?.approved) boot(session);
    }, 10000);
    return;
  }
  $("#app").innerHTML = `<div class="boot">Loading…</div>`;
  try {
    await loadAll();
  } catch (e) {
    $("#app").innerHTML = `<div class="auth-wrap"><div class="card auth"><h1>Could not load data</h1><p class="muted">${esc(errMsg(e))}</p><p class="muted">Make sure <code>supabase/schema.sql</code> has been run.</p></div></div>`;
    return;
  }
  subscribe();
  renderShell();
}

function renderSetupNeeded() {
  $("#app").innerHTML = `
  <div class="auth-wrap"><div class="card auth" style="max-width:560px">
    <div class="brand"><img class="logo" src="img/icon.svg" alt="" />${esc(APP_NAME)}</div>
    <h1>Connect Supabase</h1>
    <p class="muted">Open <code>js/config.js</code> in the GitHub repo and fill in <b>SUPABASE_URL</b> and <b>SUPABASE_ANON_KEY</b>. See <code>README.md</code> for details.</p>
  </div></div>`;
}

function renderBlocked(html, canWait = false) {
  $("#app").innerHTML = `
  <div class="auth-wrap"><div class="card auth">
    <div class="brand"><img class="logo" src="img/icon.svg" alt="" />${esc(APP_NAME)}</div>
    <h1>${canWait ? "Awaiting approval ⏳" : "Access denied"}</h1>
    <p class="muted">${html}</p>
    <button class="btn ghost" data-act="logout">Sign out</button>
  </div></div>`;
}

function renderAuth(mode = "login") {
  const signup = mode === "signup";
  $("#app").innerHTML = `
  <div class="auth-wrap"><form class="card auth" id="auth-form">
    <div class="brand"><img class="logo" src="img/icon.svg" alt="" />${esc(APP_NAME)}</div>
    <h1>${signup ? "Create account" : "Sign in"}</h1>
    <p class="muted">${signup ? "The first person to sign up becomes the owner, the only one who can approve." : "Keep good habits, together ✨"}</p>
    ${signup ? `<label class="f">Display name</label><input class="in" name="name" required maxlength="40" />` : ""}
    <label class="f">Email</label><input class="in" name="email" type="email" required autocomplete="email" />
    <label class="f">Password</label><input class="in" name="password" type="password" required minlength="6" autocomplete="${signup ? "new-password" : "current-password"}" />
    <div class="row" style="margin-top:18px">
      <button class="btn" type="submit">${signup ? "Sign up" : "Sign in"}</button>
      <span class="spacer"></span>
      <a href="#" data-act="auth-mode" data-mode="${signup ? "login" : "signup"}">${signup ? "Have an account? Sign in" : "New here? Create an account"}</a>
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
        if (!data.session) msg.innerHTML = "✅ Signed up! Check your email for the confirmation link, then come back to sign in.";
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
  ["today", "Today"],
  ["progress", "Progress"],
  ["manage", "Topics & Tasks"],
  ["chat", "Chat & Approvals"],
];

function renderShell() {
  $("#app").innerHTML = `
  <header class="topbar">
    <div class="brand"><img class="logo" src="img/icon.svg" alt="" /><span>${esc(APP_NAME)}</span></div>
    <nav class="nav" id="nav"></nav>
    <div class="me">
      <button class="icon-btn" data-act="toggle-notify" id="bell" title="Browser reminders"></button>
      ${avatar(S.me.id)}
      <div class="who-txt" style="line-height:1.1"><b>${esc(S.me.display_name)}</b><br><span class="muted" style="font-size:12px">${isOwner() ? "Owner" : "Member"}</span></div>
      <button class="icon-btn" data-act="logout" title="Sign out">⎋</button>
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
    if (k === "chat" && (pend || unread)) b = `<span class="badge" title="${pend} pending, ${unread} unread">${pend || ""}${unread ? (pend ? " · " : "") + "💬" + unread : ""}</span>`;
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
  <h1 class="page">${isToday ? "Today" : fmtDate(day)}</h1>
  <p class="sub">${isToday ? fmtDate(day) + " · " : ""}Complete a task by uploading a photo or file as proof.</p>
  <div class="stats">
    <div class="stat"><b>${doneMine.length}/${mine.length}</b><span>Your tasks done</span></div>
    <div class="stat y"><b>${streakOf(uid)} 🔥</b><span>Day streak</span></div>
    <div class="stat"><b>${gExp ? Math.round((gDone / gExp) * 100) : 0}%</b><span>Group completion</span></div>
    <div class="stat y"><b>${pendingItems().length}</b><span>Pending approval</span></div>
  </div>
  <div class="row" style="margin-bottom:16px">
    <div class="date-nav">
      <button class="btn ghost sm" data-act="day" data-d="-1">‹</button>
      <input class="in" type="date" id="day-pick" value="${day}" max="${today()}" />
      <button class="btn ghost sm" data-act="day" data-d="1" ${isToday ? "disabled" : ""}>›</button>
      ${isToday ? "" : `<button class="btn ghost sm" data-act="day" data-d="0">Today</button>`}
    </div>
    <span class="spacer"></span>
    <button class="btn y" data-act="new-task">＋ New / assign task</button>
  </div>
  ${byTopic.length ? `<div class="grid two">${byTopic.map(({ tp, list }) => `
    <div class="card">
      <div class="topic-head">
        <div class="topic-ico" style="background:${esc(tp.color)}22">${esc(tp.icon)}</div>
        <div><h2>${esc(tp.name)}</h2><span class="muted" style="font-size:13px">${list.filter((t) => checkinOf(t.id, uid, periodOf(t, day))).length}/${list.length} done</span></div>
      </div>
      ${list.map((t) => taskRow(t, day)).join("")}
    </div>`).join("")}</div>`
    : `<div class="card empty">No tasks for you yet. Tap “New / assign task” to propose one!</div>`}`;
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
        <span class="tag ${t.frequency === "weekly" ? "y" : ""}">${t.frequency === "weekly" ? "Weekly" : "Daily"}</span>
        ${t.reminder_time ? `<span class="tag">⏰ ${t.reminder_time.slice(0, 5)}</span>` : ""}
        ${t.assignee_id ? `<span class="tag y">👤 ${esc(nameOf(t.assignee_id))}</span>` : ""}
      </div>
      ${t.description ? `<div class="muted" style="font-size:13px">${esc(t.description)}</div>` : ""}
      ${c ? `
        <div class="row" style="margin-top:8px">
          ${proofHtml(c)}
          <div style="flex:1;min-width:120px">${c.note ? `<div style="font-size:13px">“${esc(c.note)}”</div>` : ""}
            <div class="time">${t.frequency === "weekly" ? "Done on " + fmtDate(c.done_on) : "Submitted " + fmtTs(c.created_at)}</div></div>
          <button class="btn danger sm" data-act="undo" data-id="${c.id}">Undo</button>
        </div>`
      : day < created && t.frequency === "daily" ? `<div class="muted" style="font-size:13px;margin-top:6px">This task did not exist yet on this day</div>`
      : `<button class="btn sm" style="margin-top:8px" data-act="submit-proof" data-id="${t.id}">📎 Upload proof</button>`}
      ${peers.length ? `<div class="peers"><span class="muted" style="font-size:12px;margin-right:4px">Done:</span>${peers.map((x) => `<span data-act="view-proof" data-id="${x.c.id}">${avatar(x.m.id, "sm")}</span>`).join("")}</div>` : ""}
    </div>
  </div>`;
}

function proofHtml(c) {
  if (!c.proof_path) return "";
  if (isImage(c.proof_name || c.proof_path)) return `<img class="proof-thumb" data-proof="${esc(c.proof_path)}" data-act="view-proof" data-id="${c.id}" alt="proof" />`;
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
const MAX_SIDE = 1280;      // cạnh dài tối đa sau khi nén
const JPEG_QUALITY = 0.72; // ~100–200 KB / ảnh

async function compressImage(file) {
  if (!file.type.startsWith("image/") || file.type === "image/gif" || file.type === "image/svg+xml") return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
    const cv = document.createElement("canvas");
    cv.width = Math.round(bmp.width * scale);
    cv.height = Math.round(bmp.height * scale);
    const ctx = cv.getContext("2d");
    ctx.fillStyle = "#fff"; // ảnh PNG trong suốt -> nền trắng
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.drawImage(bmp, 0, 0, cv.width, cv.height);
    const blob = await new Promise((r) => cv.toBlob(r, "image/jpeg", JPEG_QUALITY));
    if (!blob || blob.size >= file.size) return file;
    const base = (file.name || "photo").replace(/\.\w+$/, "") || "photo";
    return new File([blob], base + ".jpg", { type: "image/jpeg" });
  } catch {
    return file; // trình duyệt không đọc được định dạng (vd HEIC trên Chrome) -> giữ nguyên
  }
}

const kb = (n) => (n > 1024 * 1024 ? (n / 1024 / 1024).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB");

function openProofModal(taskId) {
  const t = S.tasks.find((x) => x.id === taskId);
  const day = S.date;
  let chosen = null;
  openModal(`
    <h2>Upload proof</h2>
    <p class="muted" style="margin-top:0">${esc(t.title)} · ${t.frequency === "weekly" ? "week of " + fmtDate(mondayOf(day)) : fmtDate(day)}</p>
    <label class="drop" id="proof-drop">
      <input type="file" id="proof-file" accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.mp3,.m4a,.mp4,.mov" hidden />
      <div id="proof-prev"><b>Tap to take or choose a photo</b><br><span class="muted">or paste an image (Ctrl / ⌘ + V), or drag it here</span></div>
    </label>
    <div class="muted" id="proof-size" style="font-size:12px;margin-top:6px">Photos are compressed automatically. Files up to 10 MB.</div>
    <label class="f">Note (optional)</label>
    <textarea class="in" id="proof-note" maxlength="500" placeholder="e.g. ran 5 km this morning"></textarea>
    <div class="foot">
      <button class="btn ghost" data-act="close-modal">Cancel</button>
      <button class="btn y" id="proof-go">Mark done ✓</button>
    </div>`);

  async function useFile(f) {
    if (!f) return;
    $("#proof-size").textContent = "Compressing…";
    const out = await compressImage(f);
    chosen = out;
    $("#proof-prev").innerHTML = out.type.startsWith("image/")
      ? `<img class="preview" src="${URL.createObjectURL(out)}" />`
      : `<span class="file-chip">📄 ${esc(out.name)}</span>`;
    $("#proof-size").textContent = out !== f ? `Compressed ${kb(f.size)} → ${kb(out.size)}` : `${kb(out.size)}`;
  }
  $("#proof-file").onchange = (e) => useFile(e.target.files[0]);
  const drop = $("#proof-drop");
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add("over"); };
  drop.ondragleave = () => drop.classList.remove("over");
  drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove("over"); useFile(e.dataTransfer.files[0]); };
  S.onPaste = (e) => {
    const item = [...(e.clipboardData?.items || [])].find((i) => i.kind === "file");
    if (!item) return;
    e.preventDefault();
    const f = item.getAsFile();
    useFile(f.name && f.name !== "image.png" ? f : new File([f], `pasted-${Date.now()}.${(f.type.split("/")[1] || "png")}`, { type: f.type }));
  };

  $("#proof-go").onclick = async (e) => {
    let file = chosen;
    if (!file) return toast("Please choose a photo or file first", true);
    e.target.disabled = true;
    e.target.textContent = "Uploading…";
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error("File is larger than 10 MB");
      const period = periodOf(t, day);
      const safe = file.name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\w.\-]+/g, "_").slice(-60);
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
      toast("Nice! Task done 🎉");
      render();
    } catch (err) {
      toast(errMsg(err), true);
      e.target.disabled = false;
      e.target.textContent = "Mark done ✓";
    }
  };
}

async function viewProof(id) {
  const c = S.checkins.find((x) => x.id === id);
  if (!c) return;
  const t = S.tasks.find((x) => x.id === c.task_id);
  let body = `<p class="muted">No file.</p>`;
  if (c.proof_path) {
    try {
      const url = await signedUrl(c.proof_path);
      body = isImage(c.proof_name || c.proof_path)
        ? `<a href="${esc(url)}" target="_blank" rel="noopener"><img class="preview" src="${esc(url)}" /></a>`
        : `<a class="btn" href="${esc(url)}" target="_blank" rel="noopener">📄 Open ${esc(c.proof_name || "file")}</a>`;
    } catch (e) { body = `<p class="muted">${esc(errMsg(e))}</p>`; }
  }
  openModal(`
    <div class="row">${avatar(c.user_id)}<div><h2>${esc(nameOf(c.user_id))}</h2><span class="muted">${esc(t?.title || "")} · ${fmtDate(c.done_on)}</span></div></div>
    <div style="margin-top:14px">${body}</div>
    ${c.note ? `<p>“${esc(c.note)}”</p>` : ""}
    <div class="foot"><button class="btn ghost" data-act="close-modal">Close</button></div>`);
}

async function undoCheckin(id) {
  const c = S.checkins.find((x) => x.id === id);
  if (!c || !confirm("Undo this completion? The proof file will be deleted.")) return;
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
      const tip = `${fmtDate(d)}: ${s ? `${s.done}/${s.expected} task` : "not joined yet"}`;
      cells += `<i class="l${lv}${d === end ? " today" : ""}" title="${esc(tip)}"></i>`;
    }
  }
  return { html: `<div class="row" style="align-items:flex-start;flex-wrap:nowrap"><div class="hm-days"><span>Mon</span><span></span><span>Wed</span><span></span><span>Fri</span><span></span><span>Sun</span></div><div class="hm-wrap"><div class="hm">${cells}</div></div></div>`, total };
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
  <h1 class="page">Group progress</h1>
  <p class="sub">Each square is one day. Darker means more tasks done; gold means 100%.</p>
  <div class="row" style="margin-bottom:16px">
    <div class="pills">
      <button class="${tp === "all" ? "active" : ""}" data-act="prog-topic" data-id="all">All</button>
      ${topics.map((t) => `<button class="${tp === t.id ? "active" : ""}" data-act="prog-topic" data-id="${t.id}">${esc(t.icon)} ${esc(t.name)}</button>`).join("")}
    </div>
    <span class="spacer"></span>
    <div class="pills">
      ${[12, 20, 26].map((w) => `<button class="${S.progWeeks === w ? "active" : ""}" data-act="prog-weeks" data-w="${w}">${w} weeks</button>`).join("")}
    </div>
  </div>
  <div class="card" style="margin-bottom:16px">
    <h2 style="margin-bottom:6px">🏆 This week</h2>
    ${ranked.map(({ m, r }, i) => `
      <div class="rank"><span class="n">${i === 0 && r > 0 ? "🥇" : i === 1 && r > 0 ? "🥈" : i === 2 && r > 0 ? "🥉" : i + 1}</span>${avatar(m.id)}
        <b>${esc(m.display_name)}${m.id === S.me.id ? " (you)" : ""}</b>
        <div class="bar"><div style="width:${r}%"></div></div><b style="text-align:right">${r}%</b></div>`).join("")}
  </div>
  ${ms.map((m) => {
    const h = heatmap(m.id, tp, S.progWeeks);
    return `
    <div class="card member-card">
      <div class="row" style="margin-bottom:12px">
        ${avatar(m.id)}<h2>${esc(m.display_name)}</h2>
        <span class="spacer"></span>
        <span class="tag y">🔥 ${streakOf(m.id)} days</span>
        <span class="tag">Best ${bestStreak(m.id)} days</span>
        <span class="tag">${h.total} completions</span>
      </div>
      ${h.html}
    </div>`;
  }).join("")}
  <div class="legend">Less <i style="background:var(--h0)"></i><i style="background:var(--h1)"></i><i style="background:var(--h2)"></i><i style="background:var(--h3)"></i><i style="background:var(--h4)"></i> 100%</div>`;
}

/* =============================================================
   Tab: Chủ đề & Task
   ============================================================= */
const STATUS_TAG = { pending: `<span class="tag p">Pending</span>`, rejected: `<span class="tag r">Declined</span>`, approved: "" };

function approveBtns(type, id) {
  if (!isOwner()) return "";
  return `<button class="btn ok sm" data-act="approve" data-type="${type}" data-id="${id}">Approve</button>
          <button class="btn danger sm" data-act="reject" data-type="${type}" data-id="${id}">Decline</button>`;
}

function viewManage() {
  const f = S.manageFilter;
  const uid = S.me.id;
  const taskOk = (t) => f === "all" || (f === "pending" && t.status === "pending") || (f === "mine" && (t.assignee_id === uid || t.created_by === uid));
  const topics = S.topics.filter((tp) => f === "all" || (f === "pending" && (tp.status === "pending" || S.tasks.some((t) => t.topic_id === tp.id && t.status === "pending"))) || (f === "mine" && S.tasks.some((t) => t.topic_id === tp.id && taskOk(t))));
  const canEdit = (x) => isOwner() || x.created_by === uid;
  return `
  <h1 class="page">Topics & Tasks</h1>
  <p class="sub">${isOwner() ? "You are the owner: anything you create is approved instantly, and members' proposals wait for you." : "You can propose topics, create tasks and assign them to anyone. The owner approves them."}</p>
  <div class="row" style="margin-bottom:16px">
    <div class="pills">
      <button class="${f === "all" ? "active" : ""}" data-act="mfilter" data-f="all">All</button>
      <button class="${f === "pending" ? "active" : ""}" data-act="mfilter" data-f="pending">Pending (${S.topics.filter((t) => t.status === "pending").length + S.tasks.filter((t) => t.status === "pending").length})</button>
      <button class="${f === "mine" ? "active" : ""}" data-act="mfilter" data-f="mine">Mine</button>
    </div>
    <span class="spacer"></span>
    <button class="btn ghost" data-act="ics-all">📅 Add reminders to calendar</button>
    <button class="btn ghost" data-act="new-topic">＋ ${isOwner() ? "Topic" : "Propose topic"}</button>
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
          ${tp.created_by ? `<span class="muted" style="font-size:12px">by ${esc(nameOf(tp.created_by))}</span>` : ""}</div>
        <div class="row acts">${tp.status === "pending" ? approveBtns("topic", tp.id) : ""}
        ${canEdit(tp) ? `<button class="icon-btn" data-act="edit-topic" data-id="${tp.id}" title="Edit">✏️</button>` : ""}
        ${isOwner() || (tp.created_by === uid && tp.status === "pending") ? `<button class="icon-btn" data-act="del-topic" data-id="${tp.id}" title="Delete">🗑️</button>` : ""}</div>
      </div>
      ${list.map((t) => `
        <div class="task-line ${t.status === "rejected" ? "faded" : ""}">
          <div style="flex:1 1 200px;min-width:0">
            <b>${esc(t.title)}</b> ${STATUS_TAG[t.status]}<br>
            <span class="tag ${t.frequency === "weekly" ? "y" : ""}">${t.frequency === "weekly" ? "Weekly" : "Daily"}</span>
            ${t.reminder_time ? `<span class="tag">⏰ ${t.reminder_time.slice(0, 5)}</span>` : ""}
            <span class="tag y">👤 ${t.assignee_id ? esc(nameOf(t.assignee_id)) : "Everyone"}</span>
            ${t.created_by ? `<span class="muted" style="font-size:12px">· created by ${esc(nameOf(t.created_by))}</span>` : ""}
          </div>
          <div class="row acts">${t.status === "pending" ? approveBtns("task", t.id) : ""}
          ${t.reminder_time && t.status === "approved" ? `<button class="icon-btn" data-act="ics" data-id="${t.id}" title="Add reminder to calendar">📅</button>` : ""}
          ${canEdit(t) ? `<button class="icon-btn" data-act="edit-task" data-id="${t.id}" title="Edit">✏️</button>` : ""}
          ${isOwner() || (t.created_by === uid && t.status === "pending") ? `<button class="icon-btn" data-act="del-task" data-id="${t.id}" title="Delete">🗑️</button>` : ""}</div>
        </div>`).join("") || `<div class="muted" style="font-size:14px">No tasks yet.</div>`}
      ${tp.status !== "rejected" ? `<button class="btn ghost sm" style="margin-top:10px" data-act="new-task" data-topic="${tp.id}">＋ Task in this topic</button>` : ""}
    </div>`;
  }).join("") || `<div class="card empty">Nothing here.</div>`}
  </div>
  ${isOwner() ? membersCard() : ""}`;
}

function membersCard() {
  return `
  <div class="card" style="margin-top:16px">
    <h2 style="margin-bottom:8px">👥 Members</h2>
    ${S.profiles.map((p) => `
      <div class="task-line">
        ${avatar(p.id)}<div style="flex:1"><b>${esc(p.display_name)}</b> ${p.role === "owner" ? `<span class="tag y">Owner</span>` : ""} ${p.approved ? "" : `<span class="tag p">Pending</span>`}</div>
        ${!p.approved ? approveBtns("member", p.id) : p.role !== "owner" ? `<button class="btn danger sm" data-act="reject" data-type="member" data-id="${p.id}">Remove</button>` : ""}
      </div>`).join("")}
  </div>`;
}

function openTopicModal(id) {
  const tp = id ? S.topics.find((t) => t.id === id) : null;
  const icons = ["💪", "🏃", "🧘", "🚴", "🏊", "💧", "🥗", "🍎", "😴", "🀄", "📚", "✍️", "🎧", "💼", "💻", "📈", "💰", "👨‍👩‍👧", "📞", "❤️", "🙏", "🌱", "🧹", "🎨", "🎵", "📵", "☀️", "🌙"];
  openModal(`
    <h2>${tp ? "Edit topic" : isOwner() ? "New topic" : "Propose a topic"}</h2>
    ${!isOwner() ? `<p class="muted" style="margin-top:0">The owner will review it before it goes live.</p>` : ""}
    <label class="f">Topic name</label><input class="in" id="tp-name" maxlength="60" value="${esc(tp?.name || "")}" />
    <label class="f">Icon</label>
    <div class="row">${icons.map((i) => `<button class="icon-btn" style="font-size:22px" data-act="pick-icon" data-i="${i}">${i}</button>`).join("")}</div>
    <input class="in" id="tp-icon" maxlength="8" value="${esc(tp?.icon || "⭐")}" style="margin-top:8px;width:90px" />
    <label class="f">Color</label><input type="color" id="tp-color" value="${esc(tp?.color || "#2f8f3f")}" />
    <div class="foot">
      <button class="btn ghost" data-act="close-modal">Cancel</button>
      <button class="btn y" id="tp-save">${isOwner() ? "Save" : "Send proposal"}</button>
    </div>`);
  $("#tp-save").onclick = async () => {
    const row = { name: $("#tp-name").value.trim(), icon: $("#tp-icon").value.trim() || "⭐", color: $("#tp-color").value };
    if (!row.name) return toast("Enter a topic name", true);
    const q = tp ? sb.from("topics").update(row).eq("id", tp.id) : sb.from("topics").insert(row);
    const { data, error } = await q.select().single();
    if (error) return toast(errMsg(error), true);
    upsertLocal("topics", data);
    closeModal();
    toast(data.status === "pending" ? "Proposal sent, waiting for the owner" : "Saved");
    render();
  };
}

function openTaskModal(id, topicId) {
  const t = id ? S.tasks.find((x) => x.id === id) : null;
  const topics = S.topics.filter((tp) => tp.status === "approved" || (tp.status === "pending" && tp.created_by === S.me.id) || tp.id === t?.topic_id);
  const sel = t?.topic_id || topicId || topics[0]?.id;
  const freq = t?.frequency || "daily";
  openModal(`
    <h2>${t ? "Edit task" : "New task"}</h2>
    ${!isOwner() ? `<p class="muted" style="margin-top:0">${t ? "Edited tasks" : "New tasks"} wait for the owner's approval.</p>` : ""}
    <label class="f">Task name</label><input class="in" id="tk-title" maxlength="100" value="${esc(t?.title || "")}" placeholder="e.g. Run 3 km" />
    <label class="f">Description / how to prove it</label><textarea class="in" id="tk-desc" maxlength="500" placeholder="e.g. Screenshot from your running app">${esc(t?.description || "")}</textarea>
    <div class="row" style="align-items:flex-start">
      <div style="flex:1;min-width:180px"><label class="f">Topic</label>
        <select class="in" id="tk-topic">${topics.map((tp) => `<option value="${tp.id}" ${tp.id === sel ? "selected" : ""}>${esc(tp.icon)} ${esc(tp.name)}${tp.status === "pending" ? " (pending)" : ""}</option>`).join("")}</select></div>
      <div style="flex:1;min-width:180px"><label class="f">Assign to</label>
        <select class="in" id="tk-assignee"><option value="">👥 Everyone</option>${members().map((m) => `<option value="${m.id}" ${t?.assignee_id === m.id ? "selected" : ""}>${esc(m.display_name)}${m.id === S.me.id ? " (me)" : ""}</option>`).join("")}</select></div>
    </div>
    <label class="f">Repeat</label>
    <div class="seg">
      <label><input type="radio" name="tk-freq" value="daily" ${freq === "daily" ? "checked" : ""}><span>Daily</span></label>
      <label><input type="radio" name="tk-freq" value="weekly" ${freq === "weekly" ? "checked" : ""}><span>Weekly</span></label>
    </div>
    <label class="f">Reminder at</label>
    <div class="row"><input class="in" type="time" id="tk-rem" value="${esc(t?.reminder_time?.slice(0, 5) || "")}" style="width:140px" />
      <span class="muted" style="font-size:13px">Leave empty for no reminder</span></div>
    <div class="foot">
      ${t && t.reminder_time ? `<button class="btn ghost" data-act="ics" data-id="${t.id}">📅 Add to calendar</button>` : ""}
      <span class="spacer"></span>
      <button class="btn ghost" data-act="close-modal">Cancel</button>
      <button class="btn y" id="tk-save">${isOwner() ? "Save" : "Submit for approval"}</button>
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
    if (!row.title) return toast("Enter a task name", true);
    if (!row.topic_id) return toast("Choose a topic", true);
    const q = t ? sb.from("tasks").update(row).eq("id", t.id) : sb.from("tasks").insert(row);
    const { data, error } = await q.select().single();
    if (error) return toast(errMsg(error), true);
    upsertLocal("tasks", data);
    closeModal();
    toast(data.status === "pending" ? "Submitted, waiting for the owner" : "Saved");
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
      if (!confirm(`Remove ${p?.display_name} from the group?`)) return;
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
  toast(approve ? "Approved ✅" : "Declined");
  render();
}

async function del(table, id) {
  if (!confirm(table === "topics" ? "Delete this topic and all of its tasks?" : "Delete this task?")) return;
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

/* ----- @mention ----- */
const fold = (x = "") => x.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();
const mentionNames = () => [...members().map((m) => m.display_name), "everyone"].sort((a, b) => b.length - a.length);
function mentionsMe(text) {
  const t = fold(text);
  return t.includes("@everyone") || t.includes("@" + fold(S.me.display_name));
}
function withMentions(text) {
  let html = soft(text);
  for (const n of mentionNames()) {
    const en = esc(n);
    html = html.split("@" + en).join(`<span class="mention">@${en}</span>`);
  }
  return html;
}
function mentionQuery() {
  const inp = $("#chat-input");
  if (!inp) return null;
  const before = inp.value.slice(0, inp.selectionStart);
  const m = before.match(/(?:^|\s)@([^@\n]{0,24})$/);
  return m ? { q: m[1], start: before.length - m[1].length - 1 } : null;
}
function updateMentionPop() {
  const pop = $("#mention-pop");
  if (!pop) return;
  const mq = mentionQuery();
  const list = mq ? [...members().filter((m) => m.id !== S.me.id).map((m) => ({ id: m.id, name: m.display_name })), { id: "", name: "everyone" }]
    .filter((x) => fold(x.name).includes(fold(mq.q).trim())).slice(0, 6) : [];
  pop.hidden = !list.length;
  pop.innerHTML = list.map((x, i) => `<button type="button" class="${i === 0 ? "on" : ""}" data-act="mention-pick" data-name="${esc(x.name)}">${x.id ? avatar(x.id, "sm") : `<span class="avatar sm" style="background:#a9b3a6">@</span>`}<span>${esc(x.name)}</span></button>`).join("");
}
function pickMention(name) {
  const inp = $("#chat-input");
  const mq = mentionQuery();
  if (!inp || !mq) return;
  const after = inp.value.slice(inp.selectionStart);
  inp.value = inp.value.slice(0, mq.start) + "@" + name + " " + after.replace(/^\s+/, "");
  const pos = mq.start + name.length + 2;
  inp.focus();
  inp.setSelectionRange(pos, pos);
  updateMentionPop();
}

function msgHtml(m) {
  const mine = m.user_id === S.user.id;
  if (m.kind === "chat") {
    const hit = !mine && mentionsMe(m.content);
    return `<div class="msg ${mine ? "mine" : ""} ${hit ? "hit" : ""}">${avatar(m.user_id, "sm")}
      <div><div class="who">${mine ? "" : esc(nameOf(m.user_id)) + " · "}${fmtTs(m.created_at)}</div><div class="bubble">${withMentions(m.content)}</div></div></div>`;
  }
  if (m.kind === "system") {
    return `<div class="sysmsg"><div class="box plain">${soft(m.content)} <span class="time">${fmtTs(m.created_at)}</span></div></div>`;
  }
  const ref = m.ref_type ? refInfo(m.ref_type, m.ref_id) : null;
  const status = ref ? ref.status : "deleted";
  const tag = status === "pending" ? `<span class="tag p">Pending</span>` : status === "approved" ? `<span class="tag" style="background:#dcfce7;color:#15803d">Approved</span>` : status === "rejected" ? `<span class="tag r">Declined</span>` : `<span class="tag">Deleted</span>`;
  const extra = m.ref_type === "task" && ref?.x ? `<div class="muted" style="font-size:13px;margin-top:4px">${soft(topicOf(ref.x.topic_id)?.icon || "")} ${esc(topicOf(ref.x.topic_id)?.name || "")} · ${ref.x.frequency === "weekly" ? "weekly" : "daily"}${ref.x.reminder_time ? " · " + ref.x.reminder_time.slice(0, 5) : ""}</div>` : "";
  return `<div class="sysmsg"><div class="box">
    <b>${esc(nameOf(m.user_id))}</b> ${soft(m.content)} <span class="time">${fmtTs(m.created_at)}</span>
    ${extra}
    <div class="acts">${tag}${status === "pending" ? approveBtns(m.ref_type, m.ref_id) : ""}
      ${m.ref_type === "task" && ref?.x && (isOwner() || ref.x.created_by === S.me.id) ? `<button class="btn ghost sm" data-act="edit-task" data-id="${m.ref_id}">View / edit</button>` : ""}</div>
  </div></div>`;
}

function viewChat() {
  const pend = pendingItems();
  return `
  <h1 class="page">Chat & Approvals</h1>
  <p class="sub">Talk with the group. Every topic and task proposal and join request shows up here${isOwner() ? " for you to approve" : ""}.</p>
  <div class="chat-layout">
    <div class="card chat">
      <div class="chat-list">${S.messages.map(msgHtml).join("") || `<div class="empty">No messages yet. Say hi.</div>`}</div>
      <form class="chat-form" id="chat-form">
        <div id="mention-pop" class="mention-pop" hidden></div>
        <input class="in" id="chat-input" placeholder="Message the group… type @ to mention someone" maxlength="1000" autocomplete="off" />
        <button class="btn ghost at-btn" type="button" data-act="mention-open" title="Mention someone">@</button>
        <button class="btn" type="submit">Send</button>
      </form>
    </div>
    <div>
      <div class="card">
        <h2 style="margin-bottom:6px">Pending approval <span class="count">${pend.length}</span></h2>
        ${pend.map(({ type, item }) => `
          <div class="pending-item">
            <div><span class="tag ${type === "member" ? "y" : ""}">${type === "member" ? "Member" : type === "topic" ? "Topic" : "Task"}</span>
              <b>${soft(type === "member" ? item.display_name : type === "topic" ? item.icon + " " + item.name : item.title)}</b></div>
            <div class="muted" style="font-size:12px;margin:3px 0 6px">${type === "member" ? "wants to join" : "proposed by " + esc(nameOf(item.created_by))}${type === "task" ? " · " + esc(topicOf(item.topic_id)?.name || "") + (item.assignee_id ? " · for " + esc(nameOf(item.assignee_id)) : "") : ""}</div>
            <div class="row">${isOwner() ? approveBtns(type, item.id) : `<span class="muted" style="font-size:13px">Waiting for the owner</span>`}
              ${type === "task" && (isOwner() || item.created_by === S.me.id) ? `<button class="btn ghost sm" data-act="edit-task" data-id="${item.id}">View</button>` : ""}</div>
          </div>`).join("") || `<p class="muted">Nothing to approve</p>`}
      </div>
      <div class="card" style="margin-top:16px">
        <h2 style="margin-bottom:8px">Today</h2>
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
    const hit = m.kind === "chat" && mentionsMe(m.content);
    new Notification(hit ? `@ ${who} mentioned you` : m.kind === "chat" ? who : "Needs approval", { body: m.kind === "chat" ? m.content : `${who} ${m.content}`, tag: "msg" });
  }
  if (m.kind === "chat" && mentionsMe(m.content) && S.tab !== "chat") toast(`@ ${nameOf(m.user_id)} mentioned you in chat`);
}

/* =============================================================
   Nhắc nhở
   ============================================================= */
async function toggleNotify() {
  if (!S.notify) {
    if (!("Notification" in window)) return toast("This browser does not support notifications. Use 📅 to add reminders to your calendar.", true);
    const perm = await Notification.requestPermission();
    if (perm !== "granted") return toast("Notifications are not allowed", true);
    S.notify = true;
    toast("Reminders on (while the site is open). For reminders when it is closed, use 📅 Add to calendar.");
  } else {
    S.notify = false;
    toast("Reminders off");
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
    toast(`⏰ Time for: ${t.title}`);
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification(`⏰ ${t.title}`, { body: t.description || "Don't forget to upload your proof!", tag: t.id });
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
    `DESCRIPTION:${clean((t.description || "") + "\nUpload proof at: " + location.origin + location.pathname)}`,
    "BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${clean(t.title)}`, "TRIGGER:PT0M", "END:VALARM",
    "END:VEVENT",
  ].join("\r\n");
}

function downloadIcs(list, name) {
  const withTime = list.filter((t) => t.reminder_time);
  if (!withTime.length) return toast("No tasks have a reminder time", true);
  const body = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//habit-tracker//VI", "CALSCALE:GREGORIAN", ...withTime.map(icsEvent), "END:VCALENDAR"].join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([body], { type: "text/calendar;charset=utf-8" }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast("Open the downloaded .ics file to add the reminders");
}

/* =============================================================
   Modal + sự kiện
   ============================================================= */
function openModal(html) {
  $("#modal-root").innerHTML = `<div class="modal-bg" data-act="modal-bg"><div class="modal">${html}</div></div>`;
  $("#modal-root input, #modal-root textarea")?.focus();
}
function closeModal() { $("#modal-root").innerHTML = ""; S.onPaste = null; }

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
  ics: (d) => { const t = S.tasks.find((x) => x.id === d.id); downloadIcs([t], `reminder-${t.title.normalize("NFD").replace(/[^\w]+/g, "-").slice(0, 30)}.ics`); },
  "ics-all": () => downloadIcs(tasksFor(S.me.id), "habit-reminders.ics"),
  "toggle-notify": () => toggleNotify(),
  "close-modal": () => closeModal(),
  "mention-pick": (d, el, e) => { e.preventDefault(); pickMention(d.name); },
  "mention-open": () => {
    const inp = $("#chat-input");
    const pos = inp.selectionStart ?? inp.value.length;
    const pre = inp.value.slice(0, pos);
    const ins = (pre && !/\s$/.test(pre) ? " " : "") + "@";
    inp.value = pre + ins + inp.value.slice(pos);
    inp.focus();
    inp.setSelectionRange(pos + ins.length, pos + ins.length);
    updateMentionPop();
  },
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

document.addEventListener("keydown", (e) => {
  const pop = $("#mention-pop");
  if (e.target.id === "chat-input" && pop && !pop.hidden) {
    const items = [...pop.querySelectorAll("button")];
    let i = items.findIndex((b) => b.classList.contains("on"));
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      items[i]?.classList.remove("on");
      i = (i + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length;
      items[i].classList.add("on");
      return;
    }
    if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); pickMention(items[Math.max(i, 0)].dataset.name); return; }
    if (e.key === "Escape") { pop.hidden = true; return; }
  }
  if (e.key === "Escape") closeModal();
});
document.addEventListener("paste", (e) => { if (S.onPaste && $("#proof-drop")) S.onPaste(e); });
document.addEventListener("input", (e) => { if (e.target.id === "chat-input") updateMentionPop(); });

// Đổi ngày lúc nửa đêm / quay lại tab
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && S.me?.approved && $("#main")) {
    render();
  }
});

setInterval(checkReminders, 30000);
setTimeout(checkReminders, 3000);

start();
