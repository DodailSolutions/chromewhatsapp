"use strict";
(() => {
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const S = { view: "dashboard", status: "all", q: "", list: [], stats: null, plans: [], me: null, mode: "password", payments: [], settings: null, team: [] };
  const METHODS = ["UPI", "Bank transfer", "Cash", "Card", "Cheque", "Other"];
  const ICON = {
    dashboard: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3.5" y="3.5" width="7" height="8" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="5" rx="1.5"/><rect x="13.5" y="11.5" width="7" height="9" rx="1.5"/><rect x="3.5" y="14.5" width="7" height="6" rx="1.5"/></svg>',
    licenses: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="8" cy="15" r="4"/><path d="M11 12l8-8M16 7l2 2M14 9l2 2"/></svg>',
    payments: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M7 4h10M7 8h10M7 4c4 0 6 2 6 4s-2 4-6 4l7 8"/></svg>',
    plans: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 9h8M8 13h8M8 17h5"/></svg>',
    team: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="9" cy="8.5" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><circle cx="17" cy="9.5" r="2.5"/><path d="M17 14.5c2.3 0 4 1.5 4.6 4"/></svg>',
    settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.4M12 18.8v2.4M4.2 7l2.1 1.2M17.7 15.8l2.1 1.2M4.2 17l2.1-1.2M17.7 8.2l2.1-1.2"/></svg>'
  };
  document.querySelectorAll("#nav a").forEach(a => { a.querySelector(".ni").innerHTML = ICON[a.dataset.v]; });

  // ---------- helpers ----------
  async function api(path, opts = {}) {
    const init = { method: opts.method || "GET", credentials: "same-origin", headers: { "x-requested-with": "dr-admin" } };
    if (opts.body !== undefined) { init.headers["content-type"] = "application/json"; init.body = JSON.stringify(opts.body); }
    let r;
    try { r = await fetch("/admin/api/" + path, init); } catch (e) { throw new Error("Can't reach the server. Check your connection."); }
    let j = {}; try { j = await r.json(); } catch (e) { /* non-JSON */ }
    if (r.status === 401 && !/^(login|reset|forgot)$/.test(path)) { showAuth(); throw new Error(j.error || "Please sign in."); }
    if (!r.ok || j.ok === false) throw new Error(j.error || "Request failed (" + r.status + ")");
    return j;
  }
  let toastT;
  function toast(msg) { const t = $("toast"); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 2800); }
  async function copy(text, label) {
    try { await navigator.clipboard.writeText(text); }
    catch (e) { const ta = document.createElement("textarea"); ta.value = text; document.body.append(ta); ta.select(); document.execCommand("copy"); ta.remove(); }
    toast((label || "Copied") + " ✓");
  }
  const rupee = n => "₹" + Number(n || 0).toLocaleString("en-IN");
  const fmtDate = t => t ? new Date(t).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—";
  const fmtDT = t => t ? new Date(t).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—";
  const lenLabel = d => d % 365 === 0 ? (d / 365 === 1 ? "1 year" : d / 365 + " years") : d % 30 === 0 ? (d / 30 === 1 ? "1 month" : d / 30 + " months") : d + " days";
  function ago(t) {
    if (!t) return "Never";
    const s = (Date.now() - t) / 1000;
    if (s < 90) return "Just now"; if (s < 3600) return Math.round(s / 60) + " min ago";
    if (s < 86400) return Math.round(s / 3600) + " h ago"; if (s < 86400 * 30) return Math.round(s / 86400) + " d ago";
    return fmtDate(t);
  }
  const owner = () => S.me && S.me.role === "owner";
  const LABEL = { active: "Active", expired: "Expired", deactivated: "Deactivated", unused: "Not activated" };
  function pill(l) {
    if (l.trial && l.status === "active") return `<span class="pill trial">Trial · ${l.daysLeft}d left</span>`;
    if (l.status === "active" && l.daysLeft <= 7) return `<span class="pill expiring">Expires in ${l.daysLeft}d</span>`;
    return `<span class="pill ${esc(l.status)}">${esc(l.trial && l.status === "expired" ? "Trial ended" : LABEL[l.status] || l.status)}</span>`;
  }
  const tierTag = l => l.trial ? `<span class="tier trial">Trial</span>` : `<span class="tier ${l.tier === "starter" ? "starter" : ""}">${l.tier === "starter" ? "Starter" : "AI Pro"}</span>`;
  const EVT = { created: "Key created", activated: "Activated", "re-activated": "Re-activated on same computer", registered: "Business registered", "trial-started": "Free trial started", converted: "Trial converted to paid", deactivated: "Deactivated", reactivated: "Reactivated", extended: "Renewed", released: "Computer released", "released-by-user": "Released by customer", deleted: "Deleted", updated: "Details edited", "activate-failed": "Failed activation attempt", "admin-login-failed": "Failed sign-in", "admin-login": "Signed in", "password-changed": "Password changed", "password-set": "Password set", "plan-saved": "Plan saved", "settings-saved": "Settings saved", "team-invited": "Team member invited", "team-removed": "Team member removed", "team-updated": "Team member updated" };

  // WhatsApp messages (opened with wa.me; nothing is sent automatically)
  const waNum = p => { let d = String(p || "").replace(/\D/g, ""); if (d.length === 10) d = "91" + d; return d.length >= 11 ? d : ""; };
  const first = n => String(n || "").trim().split(/\s+/)[0] || "there";
  const waLink = (phone, text) => `https://wa.me/${waNum(phone)}?text=${encodeURIComponent(text)}`;
  function keyMessage(l) {
    const c = l.customer || {};
    return `Hi ${first(c.name || c.business)}, welcome to Dodail Reach! 🎉\n\nYour license key: *${l.key}*\nPlan: ${l.plan || "Dodail Reach"} (${lenLabel(l.days)}, counted from the day you activate it).\n\nSetup (2 minutes):\n1. Unzip the Dodail Reach file we sent you.\n2. In Chrome, open chrome://extensions and turn on *Developer mode*.\n3. Click *Load unpacked* and choose the unzipped folder.\n4. Enter your license key on the welcome page and fill in your business details.\n5. Open web.whatsapp.com — your CRM appears on the right.\n\nNeed help? Just reply here.\n– Dodail Solutions`;
  }
  function renewMessage(l) {
    const c = l.customer || {};
    const when = l.status === "expired" ? `${l.trial ? "free trial ended" : "expired"} on ${fmtDate(l.expiresAt)}` : `ends on ${fmtDate(l.expiresAt)} (${l.daysLeft} day${l.daysLeft === 1 ? "" : "s"} left)`;
    const opts = S.plans.filter(p => p.active).slice(0, 6).map(p => `• ${p.name}: ${rupee(p.price)}`).join("\n");
    return `Hi ${first(c.name || c.business)}, a quick note from Dodail Solutions: your Dodail Reach ${l.trial ? "trial" : "license"} (${l.key}) for ${c.business || "your business"} ${when}.\n\n${l.trial ? "Continue without losing your CRM data" : "Renew to keep your CRM, broadcasts and AI agent running"}:\n${opts}\n\nReply with the plan you'd like and we'll share the payment details.\n– Dodail Solutions`;
  }

  // ---------- auth screens ----------
  function showAuth(which = "login") {
    $("app").hidden = true; $("auth").hidden = false;
    ["loginForm", "forgotForm", "resetForm"].forEach(id => { $(id).hidden = id !== which + "Form"; });
    const f = $(which + "Form").querySelector("input"); if (f) setTimeout(() => f.focus(), 30);
  }
  async function authMode() {
    try { const r = await fetch("/admin/api/auth-mode"); S.mode = (await r.json()).mode || "password"; } catch (e) { /* keep default */ }
    const sb = S.mode === "supabase";
    $("userLabel").textContent = sb ? "Email" : "Username"; $("lu").type = sb ? "email" : "text";
    $("loginHint").textContent = sb ? "Use your Dodail team account." : "Local mode: use the admin username and password from your setup.";
    $("forgotLink").hidden = !sb;
  }
  $("loginForm").addEventListener("submit", async e => {
    e.preventDefault(); $("lerr").hidden = true;
    const btn = e.target.querySelector("button[type=submit]"); btn.disabled = true;
    try { await api("login", { method: "POST", body: { user: $("lu").value.trim(), password: $("lp").value } }); $("lp").value = ""; await boot(); }
    catch (err) { $("lerr").textContent = err.message; $("lerr").hidden = false; }
    btn.disabled = false;
  });
  $("forgotLink").onclick = () => { $("fe").value = $("lu").value; $("fok").hidden = true; $("ferr").hidden = true; showAuth("forgot"); };
  $("backLogin").onclick = () => showAuth("login");
  $("forgotForm").addEventListener("submit", async e => {
    e.preventDefault(); $("ferr").hidden = true; $("fok").hidden = true;
    try { const r = await api("forgot", { method: "POST", body: { email: $("fe").value.trim() } }); $("fok").textContent = r.message; $("fok").hidden = false; }
    catch (err) { $("ferr").textContent = err.message; $("ferr").hidden = false; }
  });
  let resetToken = "";
  $("resetForm").addEventListener("submit", async e => {
    e.preventDefault(); $("rerr").hidden = true;
    if ($("rp").value !== $("rp2").value) { $("rerr").textContent = "The two passwords don't match."; $("rerr").hidden = false; return; }
    try { await api("reset", { method: "POST", body: { accessToken: resetToken, password: $("rp").value } }); history.replaceState(null, "", "/admin#dashboard"); await boot(); toast("Password saved. Welcome!"); }
    catch (err) { $("rerr").textContent = err.message; $("rerr").hidden = false; }
  });
  $("logoutBtn").onclick = async () => { try { await api("logout", { method: "POST" }); } catch (e) { /* ignore */ } S.me = null; showAuth("login"); };

  // ---------- routing ----------
  const VIEWS = { dashboard: viewDashboard, licenses: viewLicenses, payments: viewPayments, plans: viewPlans, team: viewTeam, settings: viewSettings };
  function go() {
    const v = (location.hash.slice(1).split("?")[0] || "dashboard");
    S.view = VIEWS[v] ? v : "dashboard";
    document.querySelectorAll("#nav a").forEach(a => a.classList.toggle("on", a.dataset.v === S.view));
    closeDrawer(); VIEWS[S.view]();
  }
  window.addEventListener("hashchange", () => { if (!$("app").hidden) go(); });
  async function boot() {
    const r = await api("me"); S.me = r.user; S.mode = r.mode;
    $("who").innerHTML = `<b>${esc(S.me.name || S.me.email)}</b><small>${esc(S.me.name ? S.me.email : "")}</small> <span class="rolepill ${S.me.role === "owner" ? "owner" : ""}">${esc(S.me.role)}</span>`;
    $("auth").hidden = true; $("app").hidden = false;
    try { S.plans = (await api("plans")).plans; } catch (e) { S.plans = []; }
    go();
  }
  const main = html => { $("main").innerHTML = html; };
  const head = (title, sub, act = "") => `<div class="head"><div><h1>${esc(title)}</h1>${sub ? `<p class="muted">${sub}</p>` : ""}</div><div class="headact">${act}</div></div>`;

  // ---------- dashboard ----------
  async function viewDashboard() {
    main(head("Dashboard", "Loading…") + `<div class="card"><p class="muted">Loading…</p></div>`);
    let st; try { st = (await api("stats")).stats; } catch (e) { return toast(e.message); }
    S.stats = st;
    const conv = st.trialsTotal ? Math.round(st.trialsConverted / st.trialsTotal * 100) : 0;
    const monthName = new Date().toLocaleDateString("en-IN", { month: "long" });
    main(head("Dashboard", `${st.total} keys · ${st.payingActive} paying customers · ${st.onlineToday} online today`, `<button class="btn pri" id="genBtn" type="button">+ New license</button>`) + `
      <section class="kpis">
        <div class="kpi main k-orange"><i></i><small>Revenue in ${esc(monthName)}</small><b>${rupee(st.revenue.month)}</b><em>${rupee(st.revenue.d30)} in the last 30 days</em></div>
        <button class="kpi k-green" data-go="licenses" data-s="paid" type="button"><i></i><small>Paying customers</small><b>${st.payingActive}</b><em>active paid licenses</em></button>
        <button class="kpi k-violet" data-go="licenses" data-s="trial" type="button"><i></i><small>Free trials running</small><b>${st.trialsActive}</b><em>${conv}% of ${st.trialsTotal} trials converted</em></button>
        <button class="kpi k-amber" data-go="licenses" data-s="expiring" type="button"><i></i><small>Ending in 7 days</small><b>${st.expiringSoon}</b><em>renewals to chase</em></button>
      </section>
      <section class="kpis">
        <button class="kpi k-blue" data-go="licenses" data-s="online" type="button"><i></i><small>Online today</small><b>${st.onlineToday}</b></button>
        <button class="kpi k-grey" data-go="licenses" data-s="expired" type="button"><i></i><small>Expired</small><b>${st.expired}</b></button>
        <button class="kpi k-red" data-go="licenses" data-s="deactivated" type="button"><i></i><small>Deactivated</small><b>${st.deactivated}</b></button>
        <button class="kpi" data-go="licenses" data-s="unused" type="button"><i></i><small>Keys not activated yet</small><b>${st.unused}</b></button>
      </section>
      <section class="grid3">
        <div class="card"><div class="ch"><h2>Revenue · last 30 days</h2><span class="muted sm">${rupee(st.revenue.total)} all time · ${st.revenue.payments} payments</span></div><div id="chart" class="chart"></div></div>
        <div class="card"><div class="ch"><h2>Renewals due</h2><span class="muted sm">next 7 days</span></div><ul class="list" id="renewals"></ul></div>
        <div class="card"><div class="ch"><h2>Recent activity</h2></div><ul class="list recent" id="recent"></ul></div>
      </section>`);
    renderChart(st.revenueDaily);
    $("renewals").innerHTML = st.renewals.length ? st.renewals.map(r => `<li><span><b>${esc(r.business || r.key)}</b><small>${r.trial ? "Trial · " : ""}${r.daysLeft} day${r.daysLeft === 1 ? "" : "s"} left · ${esc(fmtDate(r.expiresAt))}</small></span>${waNum(r.phone) ? `<button class="btn sm wa" data-remind="${esc(r.key)}" type="button">Remind</button>` : `<button class="btn sm" data-open="${esc(r.key)}" type="button">Open</button>`}</li>`).join("") : `<li class="muted">No renewals due this week.</li>`;
    $("recent").innerHTML = st.recent.length ? st.recent.map(e => `<li><i class="dot ${esc(e.type)}"></i><span><b>${esc(EVT[e.type] || e.type)}</b>${e.key ? " · <span class='key'>" + esc(e.key) + "</span>" : ""}${e.detail && !/^[\d.:a-f]+$/i.test(e.detail) ? " · " + esc(e.detail) : ""}${e.actor ? ` <small>by ${esc(e.actor)}</small>` : ""}</span><small>${esc(ago(e.t))}</small></li>`).join("") : `<li class="muted">No activity yet.</li>`;
    $("genBtn").onclick = genModal;
  }
  function renderChart(data) {
    const W = 640, H = 220, pl = 58, pb = 28, pt = 12, top = Math.max(0, ...data.map(d => d.amount));
    const step = top <= 0 ? 1000 : Math.pow(10, Math.floor(Math.log10(top))) * (top / Math.pow(10, Math.floor(Math.log10(top))) > 5 ? 2 : 1);
    const max = Math.max(1000, Math.ceil(top / step) * step), bw = (W - pl) / data.length;
    let g = "";
    for (let i = 0; i <= 2; i++) { const v = Math.round(max * i / 2), y = H - pb - (H - pb - pt) * i / 2; g += `<line x1="${pl}" x2="${W}" y1="${y}" y2="${y}" stroke="#EEF1F6"/><text x="${pl - 8}" y="${y + 5}" text-anchor="end">${v >= 1000 ? "₹" + (v / 1000).toLocaleString("en-IN") + "k" : "₹" + v}</text>`; }
    data.forEach((d, i) => {
      const h = (H - pb - pt) * d.amount / max, x = pl + i * bw + 2;
      g += `<rect x="${x}" y="${H - pb - h}" width="${Math.max(2, bw - 4)}" height="${Math.max(d.amount ? 2 : 0, h)}" rx="3" fill="#E8541A"><title>${esc(d.day)}: ${rupee(d.amount)}</title></rect>`;
      if (i % 5 === 4 || i === data.length - 1) g += `<text x="${i === data.length - 1 ? W : x + bw / 2 - 2}" y="${H - 4}" text-anchor="${i === data.length - 1 ? "end" : "middle"}">${esc(new Date(d.day).toLocaleDateString("en-IN", { day: "numeric", month: "short" }))}</text>`;
    });
    $("chart").innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Revenue per day over the last 30 days">${g}</svg>`;
  }

  // ---------- licenses ----------
  const FILTERS = [["all", "All"], ["paid", "Paying"], ["trial", "Trials"], ["expiring", "Ending soon"], ["expired", "Expired"], ["deactivated", "Deactivated"], ["unused", "Not activated"], ["online", "Online today"], ["starter", "Starter"], ["pro", "AI Pro"]];
  async function viewLicenses() {
    main(head("Licenses", "Every key you've sold or given out, and every free trial.", `<a class="btn" href="/admin/api/export.csv">Export CSV</a><button class="btn pri" id="genBtn" type="button">+ New license</button>`) + `
      <section class="card">
        <div class="toolbar"><input id="q" type="search" placeholder="Search key, business, name, phone, email, plan…" aria-label="Search licenses" value="${esc(S.q)}"></div>
        <div class="chips" id="fchips" role="group" aria-label="Filter">${FILTERS.map(([k, l]) => `<button type="button" class="chip ${S.status === k ? "on" : ""}" data-f="${k}" aria-pressed="${S.status === k}">${l}</button>`).join("")}</div>
        <div class="tablewrap"><table class="tbl"><thead><tr><th>License key</th><th>Customer</th><th>Plan</th><th>Status</th><th>Expires</th><th>Last seen</th><th class="num">Contacts</th><th></th></tr></thead><tbody id="rows"></tbody></table></div>
        <p class="empty" id="empty" hidden></p>
      </section>`);
    $("genBtn").onclick = genModal;
    $("fchips").onclick = e => { const b = e.target.closest("[data-f]"); if (!b) return; S.status = b.dataset.f; viewLicenses(); };
    let qT; $("q").addEventListener("input", () => { clearTimeout(qT); qT = setTimeout(() => { S.q = $("q").value.trim(); loadRows(); }, 250); });
    $("rows").onclick = e => {
      const cp = e.target.closest("[data-copy]"); if (cp) { e.stopPropagation(); return copy(cp.dataset.copy, "Key copied"); }
      const tr = e.target.closest("tr[data-k]"); if (!tr) return;
      const l = findL(tr.dataset.k);
      const a = e.target.closest("[data-act]"); if (a) { e.stopPropagation(); return act(l, a.dataset.act); }
      openDrawer(l);
    };
    $("rows").onkeydown = e => { if (e.key === "Enter" && e.target.matches("tr[data-k]")) openDrawer(findL(e.target.dataset.k)); };
    loadRows();
  }
  async function loadRows() {
    try { S.list = (await api("licenses?" + new URLSearchParams({ q: S.q, status: S.status }))).licenses; } catch (e) { return toast(e.message); }
    if (!$("rows")) return;
    $("rows").innerHTML = S.list.map(l => {
      const c = l.customer || {};
      const who = c.business || c.name ? `<b>${esc(c.business || c.name)}</b><small>${esc([c.business ? c.name : "", c.phone, c.city].filter(Boolean).join(" · ") || c.email || "")}</small>` : `<small>No customer yet</small>`;
      const exp = l.status === "unused" ? `<small class="muted">${esc(lenLabel(l.days))} from activation</small>` : l.expiresAt ? `${esc(fmtDate(l.expiresAt))}${l.status === "active" ? `<br><small class="muted">${l.daysLeft} days left</small>` : ""}` : "—";
      return `<tr class="click" data-k="${esc(l.key)}" tabindex="0"><td><span class="key">${esc(l.key)}</span> <button class="btn sm ghost" data-copy="${esc(l.key)}" title="Copy key" type="button">Copy</button></td>
        <td class="cust">${who}</td><td>${tierTag(l)}<br><small class="muted">${esc(l.plan || "")}</small></td><td>${pill(l)}</td><td>${exp}</td>
        <td><span class="seen"><i class="${l.online ? "on" : ""}"></i>${esc(ago(l.lastSeen))}</span>${l.version ? `<small class="muted">v${esc(l.version)}</small>` : ""}</td>
        <td class="num">${l.stats ? l.stats.contacts : "—"}</td><td><div class="rowact">${quickAction(l)}</div></td></tr>`;
    }).join("");
    const e = $("empty"); e.hidden = !!S.list.length;
    e.textContent = S.q || S.status !== "all" ? "No licenses match this filter." : "No license keys yet. Click “New license” to create one for your first customer.";
  }
  function quickAction(l) {
    if (l.status === "deactivated") return `<button class="btn sm" data-act="reactivate" type="button">Reactivate</button>`;
    if (l.status === "expired" || (l.status === "active" && (l.daysLeft <= 7 || l.trial))) return `<button class="btn sm pri" data-act="renew" type="button">${l.trial ? "Convert" : "Renew"}</button>`;
    if (l.status === "unused") return waNum(l.customer.phone) ? `<button class="btn sm wa" data-act="sendkey" type="button">Send key</button>` : (owner() ? `<button class="btn sm danger" data-act="delete" type="button">Delete</button>` : "");
    return `<button class="btn sm" data-act="renew" type="button">Renew</button>`;
  }
  const findL = k => S.list.find(x => x.key === k) || null;
  async function getL(k) { return findL(k) || ((await api("licenses?" + new URLSearchParams({ q: k }))).licenses || []).find(x => x.key === k); }
  document.addEventListener("click", async e => {
    const g = e.target.closest("[data-go]"); if (g) { S.status = g.dataset.s || "all"; S.q = ""; location.hash = g.dataset.go; if (S.view === g.dataset.go) viewLicenses(); return; }
    const r = e.target.closest("[data-remind],[data-open]"); if (r && !r.closest("#drawer")) { const l = await getL(r.dataset.remind || r.dataset.open); if (!l) return; if (r.dataset.remind) waModal(l, "renew"); else openDrawer(l); }
  });

  async function act(l, action, extra) {
    if (!l) return;
    const name = l.customer.business || l.customer.name || l.key;
    if (action === "renew") return renewModal(l);
    if (action === "sendkey") return waModal(l, "key");
    if (action === "remind") return waModal(l, "renew");
    if (action === "deactivate" && !confirm(`Deactivate ${name}? Reach stops working on their computer at its next check (within 6 hours, or when they reopen WhatsApp Web).`)) return;
    if (action === "delete") {
      if (!confirm(`Delete unused key ${l.key}? It can't be recovered.`)) return;
      try { await api("licenses/" + l.key, { method: "DELETE" }); toast("Key deleted"); closeDrawer(); refreshView(); } catch (e) { toast(e.message); }
      return;
    }
    if (action === "release" && !confirm(`Release the computer for ${name}? Reach locks on the old computer at its next check, and the same key can then be activated on a new one.`)) return;
    try {
      const r = await api(`licenses/${l.key}/${action}`, { method: "POST", body: extra || {} });
      toast({ deactivate: "License deactivated", reactivate: "License reactivated", release: "Computer released", update: "Saved" }[action] || "Done");
      refreshView();
      if (!$("drawer").hidden) openDrawer(Object.assign({}, r.license, { installId: r.license.installId ? r.license.installId.slice(0, 8) + "…" : "" }));
      return r;
    } catch (e) { toast(e.message); }
  }
  const refreshView = () => { if (S.view === "licenses") loadRows(); else if (S.view === "dashboard") viewDashboard(); else if (S.view === "payments") viewPayments(); };

  async function openDrawer(l) {
    if (!l) return;
    const c = l.customer || {}, s = l.stats || {}, canWa = !!waNum(c.phone);
    const row = (k, v) => `<span>${esc(k)}</span><b>${v === "" || v == null ? "—" : esc(v)}</b>`;
    $("drawer").innerHTML = `
      <div class="dh"><div><div class="key">${esc(l.key)}</div><div class="mt6">${pill(l)} ${tierTag(l)} <span class="paid" id="paidTag" hidden></span></div></div><button class="btn ghost" data-close type="button" aria-label="Close">✕</button></div>
      <div class="actions">
        <button class="btn sm" data-copy="${esc(l.key)}" type="button">Copy key</button>
        ${canWa ? `<button class="btn sm wa" data-x="sendkey" type="button">Send key on WhatsApp</button>` : ""}
        <button class="btn sm pri" data-x="renew" type="button">${l.trial ? "Convert to paid" : "Renew / change plan"}</button>
        ${canWa && (l.status === "expired" || (l.status === "active" && l.daysLeft <= 10)) ? `<button class="btn sm wa" data-x="remind" type="button">${l.trial ? "Trial follow-up" : "Renewal reminder"}</button>` : ""}
        ${l.status === "deactivated" ? `<button class="btn sm" data-x="reactivate" type="button">Reactivate</button>` : `<button class="btn sm danger" data-x="deactivate" type="button">Deactivate</button>`}
        ${l.installId ? `<button class="btn sm" data-x="release" type="button">Release computer</button>` : ""}
        ${l.status === "unused" && owner() ? `<button class="btn sm danger" data-x="delete" type="button">Delete key</button>` : ""}
      </div>
      <div><h3 class="sh">License</h3><div class="kv">
        ${row("Plan", l.plan)}${row(l.activatedAt ? "First length" : "Length", lenLabel(l.days))}${row("Created", fmtDate(l.createdAt))}${row("Activated", fmtDate(l.activatedAt))}
        ${row("Expires", l.expiresAt ? fmtDate(l.expiresAt) + (l.status === "active" ? ` (${l.daysLeft} days left)` : "") : "Clock starts at activation")}
        ${row("Computer", l.installId || "Not bound")}${row("Last seen", ago(l.lastSeen))}${row("Version", l.version ? "v" + l.version : "")}${row("Terms accepted", l.termsAt ? fmtDT(l.termsAt) : "")}
      </div></div>
      <div><h3 class="sh">Usage (from last check)</h3><div class="kv">${row("Category", s.category || c.category)}${row("CRM contacts", s.contacts)}${row("Sent today", s.sentToday)}${row("AI agent", s.aiMode)}</div></div>
      <form id="editForm"><h3 class="sh">Customer</h3><div class="fgrid">
        <label>Business<input name="business" value="${esc(c.business)}" maxlength="120"></label><label>Contact name<input name="name" value="${esc(c.name)}" maxlength="120"></label>
        <label>WhatsApp number<input name="phone" value="${esc(c.phone)}" maxlength="20" inputmode="tel"></label><label>Email<input name="email" type="email" value="${esc(c.email)}" maxlength="120"></label>
        <label>City<input name="city" value="${esc(c.city)}" maxlength="60"></label><label class="wide">Note (only your team sees this)<input name="note" value="${esc(l.note)}" maxlength="200"></label>
      </div><div class="mrow mt12"><button class="btn pri" type="submit">Save details</button></div></form>
      <div><h3 class="sh">Payments</h3><ul class="hist" id="pays"><li class="muted">Loading…</li></ul></div>
      <div><h3 class="sh">History</h3><ul class="hist" id="hist"><li class="muted">Loading…</li></ul></div>`;
    $("drawer").hidden = false; $("scrim").hidden = false;
    $("drawer").onclick = e => {
      if (e.target.closest("[data-close]")) return closeDrawer();
      const cp = e.target.closest("[data-copy]"); if (cp) return copy(cp.dataset.copy, "Key copied");
      const x = e.target.closest("[data-x]"); if (x) act(l, x.dataset.x);
    };
    $("editForm").onsubmit = e => { e.preventDefault(); act(l, "update", Object.fromEntries(new FormData(e.target))); };
    try {
      const h = await api(`licenses/${l.key}/history`);
      if ($("drawer").hidden || !$("hist")) return;
      $("pays").innerHTML = h.payments.length ? h.payments.map(p => `<li><span><b>${rupee(p.amount)} · ${esc(p.planName || lenLabel(p.days))}</b><small>${esc(p.receiptNo)} · ${esc(fmtDT(p.paidAt))}${p.method ? " · " + esc(p.method) : ""}</small></span><a class="btn sm" href="/admin/receipt.html?id=${p.id}" target="_blank" rel="noopener">Receipt</a></li>`).join("") : `<li class="muted">No payments recorded.</li>`;
      $("hist").innerHTML = h.events.length ? h.events.map(ev => `<li><span><b>${esc(EVT[ev.type] || ev.type)}</b>${ev.detail ? " · " + esc(ev.detail) : ""}<small>${esc(fmtDT(ev.t))}${ev.actor ? " · " + esc(ev.actor) : ""}</small></span></li>`).join("") : `<li class="muted">No history yet.</li>`;
      if (h.paid) { $("paidTag").hidden = false; $("paidTag").textContent = "Paid " + rupee(h.paid); }
    } catch (e) { if ($("hist")) $("hist").innerHTML = `<li class="muted">${esc(e.message)}</li>`; }
  }
  function closeDrawer() { $("drawer").hidden = true; if ($("modal").hidden) $("scrim").hidden = true; }
  $("scrim").onclick = () => { if (!$("modal").hidden) closeModal(); else closeDrawer(); };
  document.addEventListener("keydown", e => { if (e.key === "Escape") { if (!$("modal").hidden) closeModal(); else closeDrawer(); } });

  // ---------- modals ----------
  let lastFocus = null;
  function modal(html) {
    lastFocus = document.activeElement;
    $("modal").innerHTML = `<div class="mbox">${html}</div>`; $("modal").hidden = false; $("scrim").hidden = false;
    const f = $("modal").querySelector("input,select,button"); if (f) f.focus();
  }
  function closeModal() { $("modal").hidden = true; if ($("drawer").hidden) $("scrim").hidden = true; if (lastFocus && lastFocus.focus) lastFocus.focus(); }
  $("modal").addEventListener("click", e => { if (e.target === $("modal") || e.target.closest("[data-cancel]")) closeModal(); });

  const activePlans = () => S.plans.filter(p => p.active);
  const planPicker = (sel) => `<div class="planpick" role="radiogroup" aria-label="Plan">${activePlans().map(p => `<button type="button" data-plan="${esc(p.id)}" class="${p.id === sel ? "on" : ""}" role="radio" aria-checked="${p.id === sel}"><b>${esc(p.name)}</b><small>${rupee(p.price)} · ${esc(lenLabel(p.days))}</small></button>`).join("")}</div>`;
  const payFields = (amount) => `<div class="fgrid mt12"><label>Amount received (₹)<input name="amount" type="number" min="0" step="1" value="${amount || ""}" placeholder="0 = no payment yet"></label>
      <label>Payment method<select name="method">${METHODS.map(m => `<option>${m}</option>`).join("")}</select></label>
      <label class="wide">Reference (UPI ref / UTR / cheque no.)<input name="reference" maxlength="80" placeholder="Optional"></label></div>`;
  function bindPlanPicker(form, onPick) {
    form.addEventListener("click", e => {
      const b = e.target.closest("[data-plan]"); if (!b) return;
      form.querySelectorAll("[data-plan]").forEach(x => { x.classList.toggle("on", x === b); x.setAttribute("aria-checked", x === b); });
      form.dataset.plan = b.dataset.plan; const p = S.plans.find(x => x.id === b.dataset.plan);
      if (p && form.amount) form.amount.value = p.price; if (onPick) onPick(p);
    });
  }

  function renewModal(l) {
    const name = l.customer.business || l.customer.name || l.key;
    const cur = S.plans.find(p => p.id === l.planId && p.active) || activePlans().find(p => p.tier === (l.tier === "starter" ? "starter" : "pro")) || activePlans()[0];
    modal(`<h2>${l.trial ? "Convert trial to paid" : "Renew"} · ${esc(name)}</h2>
      <p class="hint">${l.status === "unused" ? "The key isn't activated yet, so the plan's days are added to it." : l.status === "active" ? `Days are added after the current end date (${esc(fmtDate(l.expiresAt))}).` : "Days are counted from today."} The same key keeps working; Reach picks up the new plan at its next check.</p>
      <form id="renewForm" data-plan="${esc(cur ? cur.id : "")}">${activePlans().length ? planPicker(cur && cur.id) : `<p class="banner">No active plans. Add one under Plans &amp; prices.</p>`}
      ${payFields(cur ? cur.price : "")}
      <p class="err" id="rnerr" hidden></p>
      <div class="mrow mt12"><button class="btn" type="button" data-cancel>Cancel</button><button class="btn pri" type="submit">${l.trial ? "Convert" : "Renew"}</button></div></form>`);
    const f = $("renewForm"); bindPlanPicker(f);
    f.onsubmit = async e => {
      e.preventDefault();
      if (!f.dataset.plan) { $("rnerr").textContent = "Choose a plan."; $("rnerr").hidden = false; return; }
      try {
        const r = await api(`licenses/${l.key}/extend`, { method: "POST", body: { planId: f.dataset.plan, amount: +f.amount.value || 0, method: f.method.value, reference: f.reference.value } });
        closeModal(); toast(`Done${r.payment ? " · receipt " + r.payment.receiptNo : ""}`); refreshView();
        if (!$("drawer").hidden) openDrawer(r.license);
        if (r.payment) receiptPrompt(r.payment, r.license);
      } catch (err) { $("rnerr").textContent = err.message; $("rnerr").hidden = false; }
    };
  }
  function receiptPrompt(p, l) {
    const phone = l && waNum(l.customer.phone);
    const text = `Hi ${first(l && (l.customer.name || l.customer.business))}, thank you for your payment of ${rupee(p.amount)} for Dodail Reach (${p.planName || lenLabel(p.days)}). Receipt no. ${p.receiptNo}. Your license ${p.key} is active until ${fmtDate(l && l.expiresAt)}.\n– Dodail Solutions`;
    modal(`<h2>Payment recorded</h2><p class="hint">Receipt <b>${esc(p.receiptNo)}</b> for ${rupee(p.amount)}. Print it or save it as PDF, and send the customer a confirmation.</p>
      <pre class="msgprev">${esc(text)}</pre>
      <div class="mrow"><a class="btn" href="/admin/receipt.html?id=${p.id}" target="_blank" rel="noopener">Open receipt</a>${phone ? `<a class="btn wa" href="${esc(waLink(phone, text))}" target="_blank" rel="noopener">Send on WhatsApp</a>` : ""}<button class="btn pri" type="button" data-cancel>Done</button></div>`);
  }
  function waModal(l, kind) {
    const text = kind === "key" ? keyMessage(l) : renewMessage(l), phone = waNum(l.customer.phone);
    modal(`<h2>${kind === "key" ? "Send the key on WhatsApp" : l.trial ? "Trial follow-up" : "Send a renewal reminder"}</h2>
      <p class="hint">Opens WhatsApp with this message to ${esc(l.customer.business || l.customer.name || "the customer")} (+${esc(phone)}). Check it, then press Send.</p>
      <pre class="msgprev">${esc(text)}</pre>
      <div class="mrow"><button class="btn" type="button" id="waCopy">Copy message</button><a class="btn pri" id="waGo" href="${esc(waLink(phone, text))}" target="_blank" rel="noopener">Open WhatsApp</a></div>`);
    $("waCopy").onclick = () => copy(text, "Message copied");
    $("waGo").addEventListener("click", () => setTimeout(closeModal, 300));
  }
  function genModal() {
    const def = activePlans().find(p => p.id === "pro-1m") || activePlans()[0];
    modal(`<h2>New license</h2>
      <p class="hint">Each key unlocks Reach on one computer. The plan starts when the customer activates it.</p>
      <form id="genForm" data-plan="${esc(def ? def.id : "")}">${activePlans().length ? planPicker(def && def.id) : `<p class="banner">No active plans. Add one under Plans &amp; prices first.</p>`}
        <div class="fgrid mt12">
          <label>Business name<input name="business" maxlength="120" placeholder="Smile Dental Care"></label><label>Contact name<input name="name" maxlength="120" placeholder="Dr. Priya"></label>
          <label>WhatsApp number<input name="phone" maxlength="20" inputmode="tel" placeholder="98xxxxxx10"></label><label>Email<input name="email" type="email" maxlength="120"></label>
          <label>City<input name="city" maxlength="60"></label><label>How many keys<input name="count" type="number" min="1" max="100" value="1"></label>
        </div>
        ${payFields(def ? def.price : "")}
        <label class="mt12">Note (only your team sees this)<input name="note" maxlength="200"></label>
        <p class="err" id="gerr" hidden></p>
        <div class="mrow mt12"><button class="btn" type="button" data-cancel>Cancel</button><button class="btn pri" type="submit">Create</button></div></form>`);
    const f = $("genForm"); bindPlanPicker(f);
    f.onsubmit = async e => {
      e.preventDefault();
      if (!f.dataset.plan) { $("gerr").textContent = "Choose a plan."; $("gerr").hidden = false; return; }
      const b = Object.fromEntries(new FormData(f)); b.planId = f.dataset.plan; b.count = +b.count || 1; b.amount = +b.amount || 0;
      const btn = f.querySelector("button[type=submit]"); btn.disabled = true;
      try {
        const r = await api("licenses", { method: "POST", body: b });
        const plan = S.plans.find(p => p.id === b.planId), one = r.keys.length === 1, phone = waNum(b.phone);
        const fake = { key: r.keys[0], days: plan ? plan.days : 30, plan: plan ? plan.name : "", customer: { name: b.name, business: b.business, phone: b.phone } };
        modal(`<h2>${one ? "Your new key" : r.keys.length + " new keys"}</h2>
          <p class="hint">${one && phone ? "Send it to the customer on WhatsApp with the setup steps, or copy it." : "Send each key to its customer. They enter it on Reach's welcome page."}${r.payment ? ` Receipt <b>${esc(r.payment.receiptNo)}</b> recorded.` : ""}</p>
          <div class="keys">${r.keys.map(k => `<div><span>${esc(k)}</span><button class="btn sm" data-copy="${esc(k)}" type="button">Copy</button></div>`).join("")}</div>
          <div class="mrow"><button class="btn" id="copyAll" type="button">${one ? "Copy key" : "Copy all"}</button>${r.payment ? `<a class="btn" href="/admin/receipt.html?id=${r.payment.id}" target="_blank" rel="noopener">Receipt</a>` : ""}${one && phone ? `<a class="btn wa" href="${esc(waLink(phone, keyMessage(fake)))}" target="_blank" rel="noopener">Send on WhatsApp</a>` : ""}<button class="btn pri" type="button" data-cancel>Done</button></div>`);
        $("copyAll").onclick = () => copy(r.keys.join("\n"), one ? "Key copied" : r.keys.length + " keys copied");
        $("modal").querySelectorAll("[data-copy]").forEach(b2 => { b2.onclick = () => copy(b2.dataset.copy, "Key copied"); });
        refreshView();
      } catch (err) { $("gerr").textContent = err.message; $("gerr").hidden = false; btn.disabled = false; }
    };
  }

  // ---------- payments ----------
  async function viewPayments() {
    main(head("Payments", "Every payment you've recorded. Each one has a printable receipt.", `<a class="btn" href="/admin/api/payments.csv">Export CSV</a>`) + `<div class="card"><p class="muted">Loading…</p></div>`);
    let r, st; try { [r, st] = await Promise.all([api("payments"), api("stats")]); } catch (e) { return toast(e.message); }
    S.payments = r.payments; const rv = st.stats.revenue;
    main(head("Payments", "Every payment you've recorded. Each one has a printable receipt.", `<a class="btn" href="/admin/api/payments.csv">Export CSV</a>`) + `
      <section class="kpis"><div class="kpi main k-orange"><i></i><small>This month</small><b>${rupee(rv.month)}</b></div><div class="kpi k-green"><i></i><small>Last 30 days</small><b>${rupee(rv.d30)}</b></div><div class="kpi k-blue"><i></i><small>All time</small><b>${rupee(rv.total)}</b></div><div class="kpi"><i></i><small>Payments</small><b>${rv.payments}</b></div></section>
      <section class="card"><div class="tablewrap"><table class="tbl"><thead><tr><th>Receipt</th><th>Date</th><th>Customer</th><th>Plan</th><th class="num">Amount</th><th>Method</th><th>Recorded by</th><th></th></tr></thead><tbody>
      ${S.payments.map(p => `<tr><td class="key">${esc(p.receiptNo)}</td><td>${esc(fmtDT(p.paidAt))}</td><td class="cust"><b>${esc(p.customer.business || p.customer.name || "—")}</b><small class="key">${esc(p.key)}</small></td><td>${esc(p.planName || lenLabel(p.days))}</td><td class="num"><b>${rupee(p.amount)}</b></td><td>${esc(p.method)}${p.reference ? `<br><small class="muted">${esc(p.reference)}</small>` : ""}</td><td><small>${esc(p.actor)}</small></td><td><a class="btn sm" href="/admin/receipt.html?id=${p.id}" target="_blank" rel="noopener">Receipt</a></td></tr>`).join("")}
      </tbody></table></div>${S.payments.length ? "" : `<p class="empty">No payments yet. Record one when you create or renew a license.</p>`}</section>`);
  }

  // ---------- plans ----------
  async function viewPlans() {
    try { S.plans = (await api("plans")).plans; } catch (e) { return toast(e.message); }
    const group = tier => S.plans.filter(p => p.tier === tier);
    const card = p => `<div class="plan ${p.active ? "" : "off"}"><div class="pm"><b>${esc(p.name)}</b><span class="tier ${p.tier === "starter" ? "starter" : ""}">${p.tier === "starter" ? "Starter" : "AI Pro"}</span></div>
      <div class="pp">${rupee(p.price)} <small>/ ${esc(lenLabel(p.days))}</small></div><small class="muted">${rupee(Math.round(p.price / Math.max(1, p.days / 30)))} per month${p.active ? "" : " · hidden from customers"}</small>
      <p>${esc(p.features)}</p>${owner() ? `<div class="mrow"><button class="btn sm" data-edit="${esc(p.id)}" type="button">Edit</button></div>` : ""}</div>`;
    main(head("Plans & prices", "What you sell. Customers see active plans in Reach when a trial or license ends.", owner() ? `<button class="btn pri" id="addPlan" type="button">+ Add plan</button>` : "") + `
      <section class="tiergroup"><h3>Starter · CRM and broadcasts</h3><div class="plans">${group("starter").map(card).join("") || `<p class="muted">No Starter plans.</p>`}</div></section>
      <section class="tiergroup"><h3>AI Pro · everything + AI agent</h3><div class="plans">${group("pro").map(card).join("") || `<p class="muted">No AI Pro plans.</p>`}</div></section>`);
    if (owner()) {
      $("addPlan").onclick = () => planModal(null);
      $("main").querySelectorAll("[data-edit]").forEach(b => { b.onclick = () => planModal(S.plans.find(p => p.id === b.dataset.edit)); });
    }
  }
  function planModal(p) {
    const d = p || { id: "", name: "", tier: "pro", days: 30, price: "", features: "", active: true, sort: (S.plans.length + 1) * 10 };
    modal(`<h2>${p ? "Edit plan" : "Add plan"}</h2>
      <form id="planForm"><div class="fgrid">
        <label class="wide">Plan name<input name="name" maxlength="60" required value="${esc(d.name)}" placeholder="AI Pro · 3 months"></label>
        <label>Tier<select name="tier"><option value="starter" ${d.tier === "starter" ? "selected" : ""}>Starter (no AI agent)</option><option value="pro" ${d.tier !== "starter" ? "selected" : ""}>AI Pro (all features)</option></select></label>
        <label>Length<select name="len">${[[30, "1 month"], [90, "3 months"], [180, "6 months"], [365, "1 year"]].map(([v, t]) => `<option value="${v}" ${d.days === v ? "selected" : ""}>${t}</option>`).join("")}<option value="custom" ${[30, 90, 180, 365].includes(d.days) ? "" : "selected"}>Custom days</option></select></label>
        <label>Days<input name="days" type="number" min="1" max="3660" value="${d.days}"></label>
        <label>Price (₹)<input name="price" type="number" min="0" step="1" required value="${d.price}"></label>
        <label class="wide">What's included (shown to customers)<textarea name="features" maxlength="300">${esc(d.features)}</textarea></label>
        <label>Order<input name="sort" type="number" value="${d.sort}"></label>
        <label class="inline"><input type="checkbox" name="active" ${d.active ? "checked" : ""}> Available to sell</label>
      </div><p class="err" id="perr" hidden></p>
      <div class="mrow mt12"><button class="btn" type="button" data-cancel>Cancel</button><button class="btn pri" type="submit">Save plan</button></div></form>`);
    const f = $("planForm");
    f.len.onchange = () => { if (f.len.value !== "custom") f.days.value = f.len.value; };
    f.onsubmit = async e => {
      e.preventDefault();
      try { const r = await api("plans", { method: "POST", body: { id: d.id, name: f.name.value, tier: f.tier.value, days: +f.days.value, price: +f.price.value, features: f.features.value, sort: +f.sort.value, active: f.active.checked } }); S.plans = r.plans; closeModal(); toast("Plan saved"); viewPlans(); }
      catch (err) { $("perr").textContent = err.message; $("perr").hidden = false; }
    };
  }

  // ---------- team ----------
  async function viewTeam() {
    let r; try { r = await api("team"); } catch (e) { return toast(e.message); }
    S.team = r.team;
    const sb = r.mode === "supabase";
    main(head("Team", sb ? "People who can sign in to this portal. Owners manage prices, settings and the team; staff sell and renew." : "Single-password mode") + (sb ? `
      <section class="grid2">
        <div class="card"><div class="ch"><h2>Members</h2></div><div class="tablewrap"><table class="tbl narrow"><thead><tr><th>Name</th><th>Role</th><th>Last sign-in</th><th></th></tr></thead><tbody>
        ${S.team.map(a => `<tr><td class="cust"><b>${esc(a.name || a.email)}</b><small>${esc(a.email)}</small></td><td><span class="rolepill ${a.role === "owner" ? "owner" : ""}">${esc(a.role)}</span>${a.active ? "" : ` <small class="muted">removed</small>`}</td><td><small>${esc(a.lastLogin ? ago(a.lastLogin) : "Not yet")}</small></td>
          <td><div class="rowact">${owner() && a.email !== S.me.email ? (a.active ? `<button class="btn sm" data-role="${esc(a.email)}" data-to="${a.role === "owner" ? "staff" : "owner"}" type="button">Make ${a.role === "owner" ? "staff" : "owner"}</button><button class="btn sm danger" data-remove="${esc(a.email)}" type="button">Remove</button>` : `<button class="btn sm" data-restore="${esc(a.email)}" type="button">Restore</button>`) : ""}</div></td></tr>`).join("")}
        </tbody></table></div></div>
        ${owner() ? `<div class="card"><div class="ch"><h2>Invite a team member</h2></div><form id="invForm" class="fgrid">
          <label>Name<input name="name" maxlength="80" placeholder="Priya"></label><label>Role<select name="role"><option value="staff">Staff (sell and renew)</option><option value="owner">Owner (everything)</option></select></label>
          <label class="wide">Email<input name="email" type="email" required placeholder="priya@dodail.com"></label>
          <p class="hint wide">Supabase emails them a link to set their password. They then sign in here with that email.</p>
          <p class="err wide" id="ierr" hidden></p><div class="mrow wide"><button class="btn pri" type="submit">Send invitation</button></div></form></div>` : ""}
      </section>` : `<div class="card"><p>This portal is using one shared admin password. Connect Supabase (see the setup guide) to give each team member their own email sign-in, roles and password reset.</p></div>`));
    if (!sb || !owner()) return;
    $("invForm").onsubmit = async e => {
      e.preventDefault();
      try { const x = await api("team", { method: "POST", body: Object.fromEntries(new FormData(e.target)) }); toast(x.note); viewTeam(); }
      catch (err) { $("ierr").textContent = err.message; $("ierr").hidden = false; }
    };
    $("main").onclick = async e => {
      const b = e.target.closest("[data-role],[data-remove],[data-restore]"); if (!b) return;
      const email = b.dataset.role || b.dataset.remove || b.dataset.restore;
      if (b.dataset.remove && !confirm(`Remove ${email}? They're signed out at once and can't sign in again unless you restore them.`)) return;
      const body = b.dataset.role ? { role: b.dataset.to } : { active: !b.dataset.remove };
      try { await api("team/" + encodeURIComponent(email), { method: "POST", body }); toast("Team updated"); viewTeam(); } catch (err) { toast(err.message); }
    };
  }

  // ---------- settings ----------
  async function viewSettings() {
    let s; try { s = await api("settings"); } catch (e) { return toast(e.message); }
    S.settings = s;
    const dis = owner() ? "" : "disabled";
    const cfg = `self.REACH_LICENSE_CONFIG = {\n  server: ${JSON.stringify(location.origin)},\n  publicKey: ${JSON.stringify(s.publicKey)}\n};`;
    main(head("Settings", owner() ? "" : "Only owners can change settings.") + `
      <section class="setgrid">
        <div class="card"><div class="ch"><h2>Free trial</h2></div><form data-k="trial">
          <label class="inline"><input type="checkbox" name="enabled" ${s.trial.enabled ? "checked" : ""} ${dis}> Let new customers start a free trial from Reach's welcome page</label>
          <div class="fgrid"><label>Trial length (days)<input name="days" type="number" min="1" max="30" value="${s.trial.days}" ${dis}></label>
          <label>Trial includes<select name="tier" ${dis}><option value="pro" ${s.trial.tier !== "starter" ? "selected" : ""}>Everything (AI Pro)</option><option value="starter" ${s.trial.tier === "starter" ? "selected" : ""}>Starter only</option></select></label></div>
          <p class="hint">One trial per computer, WhatsApp number and email. Trials show in Licenses with a purple tag.</p>${owner() ? `<div class="mrow"><button class="btn pri" type="submit">Save</button></div>` : ""}</form></div>
        <div class="card"><div class="ch"><h2>Update notice</h2></div><form data-k="update">
          <p class="hint">When you publish a new Reach version, enter it here. Customers on older versions see “New version available” with your download link.</p>
          <div class="fgrid"><label>Latest version<input name="version" value="${esc(s.update.version)}" placeholder="0.9.0" ${dis}></label><label>Download link (https)<input name="url" value="${esc(s.update.url)}" placeholder="https://dodail.com/reach/download" ${dis}></label>
          <label class="wide">What's new (one line)<input name="notes" maxlength="300" value="${esc(s.update.notes)}" ${dis}></label></div>${owner() ? `<div class="mrow"><button class="btn pri" type="submit">Save</button></div>` : ""}</form></div>
        <div class="card"><div class="ch"><h2>Company details on receipts</h2></div><form data-k="company"><div class="fgrid">
          <label class="wide">Company name<input name="name" value="${esc(s.company.name)}" ${dis}></label><label class="wide">Address<input name="address" value="${esc(s.company.address)}" ${dis}></label>
          <label>GSTIN<input name="gstin" value="${esc(s.company.gstin)}" placeholder="Optional" ${dis}></label><label>Email<input name="email" value="${esc(s.company.email)}" ${dis}></label>
          <label>Phone<input name="phone" value="${esc(s.company.phone)}" ${dis}></label><label>Website<input name="website" value="${esc(s.company.website)}" ${dis}></label>
          <label class="wide">Footer line<input name="footer" value="${esc(s.company.footer)}" ${dis}></label></div>${owner() ? `<div class="mrow"><button class="btn pri" type="submit">Save</button></div>` : ""}</form></div>
        <div class="card"><div class="ch"><h2>How customers buy</h2></div><form data-k="sales"><div class="fgrid">
          <label>Sales WhatsApp number<input name="whatsapp" value="${esc(s.sales.whatsapp)}" placeholder="919966400235" ${dis}></label><label>Buy page link (optional, https)<input name="buyUrl" value="${esc(s.sales.buyUrl)}" placeholder="https://dodail.com/reach" ${dis}></label></div>
          <p class="hint">Reach's “Buy a plan” and “Renew” buttons open this WhatsApp number (or your buy page).</p>${owner() ? `<div class="mrow"><button class="btn pri" type="submit">Save</button></div>` : ""}</form></div>
        <div class="card"><div class="ch"><h2>Extension connection</h2></div><p class="hint">license-config.js in the Reach extension folder should contain this. Licenses keep working offline for ${s.graceDays} days.</p><div class="code mt6">${esc(cfg)}</div><div class="mrow mt6"><button class="btn sm" id="copyCfg" type="button">Copy</button></div></div>
        ${s.mode === "password" && owner() ? `<div class="card"><div class="ch"><h2>Admin password</h2></div><form id="pwForm"><div class="fgrid"><label>Current password<input name="current" type="password" autocomplete="current-password" required></label><label>New password (10+ characters)<input name="next" type="password" minlength="10" autocomplete="new-password" required></label></div><p class="err" id="pwerr" hidden></p><div class="mrow"><button class="btn pri" type="submit">Change password</button></div></form></div>` : `<div class="card"><div class="ch"><h2>Your password</h2></div><p class="hint">Sign-in is handled by Supabase. To change your password, sign out and use “Forgot password?”.</p></div>`}
      </section>`);
    $("copyCfg").onclick = () => copy(cfg, "Config copied");
    $("main").querySelectorAll("form[data-k]").forEach(f => {
      f.onsubmit = async e => {
        e.preventDefault();
        const b = Object.fromEntries(new FormData(f)); if (f.dataset.k === "trial") b.enabled = f.enabled.checked;
        try { await api("settings/" + f.dataset.k, { method: "POST", body: b }); toast("Saved"); } catch (err) { toast(err.message); }
      };
    });
    if ($("pwForm")) $("pwForm").onsubmit = async e => {
      e.preventDefault();
      try { await api("password", { method: "POST", body: Object.fromEntries(new FormData(e.target)) }); toast("Password changed. Other sessions are signed out."); e.target.reset(); }
      catch (err) { $("pwerr").textContent = err.message; $("pwerr").hidden = false; }
    };
  }

  // ---------- start ----------
  (async () => {
    await authMode();
    const hp = new URLSearchParams(location.hash.slice(1));
    if (hp.get("access_token") && /^(recovery|invite|signup|magiclink)$/.test(hp.get("type") || "")) {
      resetToken = hp.get("access_token");
      $("resetTitle").textContent = hp.get("type") === "invite" ? "Welcome to the team" : "Set a new password";
      $("resetHint").textContent = hp.get("type") === "invite" ? "Choose a password for your Dodail Reach portal account (at least 10 characters)." : "Choose a new password with at least 10 characters.";
      history.replaceState(null, "", "/admin");
      return showAuth("reset");
    }
    if (hp.get("error_description")) { showAuth("login"); $("lerr").textContent = hp.get("error_description").replace(/\+/g, " "); $("lerr").hidden = false; return; }
    try { await boot(); } catch (e) { showAuth("login"); }
  })();
  setInterval(() => { if (!$("app").hidden && $("modal").hidden && $("drawer").hidden && document.visibilityState === "visible" && S.view === "dashboard") viewDashboard(); }, 120000);
})();
