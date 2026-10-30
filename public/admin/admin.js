"use strict";
(() => {
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const S = { status: "all", q: "", list: [], stats: null };
  const DAYS = [[30, "1 month"], [90, "3 months"], [180, "6 months"], [365, "1 year"], [7, "7-day trial"]];

  async function api(path, opts = {}) {
    const init = { method: opts.method || "GET", credentials: "same-origin", headers: { "x-requested-with": "dr-admin" } };
    if (opts.body !== undefined) { init.headers["content-type"] = "application/json"; init.body = JSON.stringify(opts.body); }
    let r;
    try { r = await fetch("/admin/api/" + path, init); } catch (e) { throw new Error("Can't reach the server. Check your connection."); }
    let j = {}; try { j = await r.json(); } catch (e) { /* non-JSON */ }
    if (r.status === 401 && path !== "login") { showLogin(); throw new Error(j.error || "Please log in."); }
    if (!r.ok || j.ok === false) throw new Error(j.error || "Request failed (" + r.status + ")");
    return j;
  }
  let toastT;
  function toast(msg) { const t = $("toast"); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 2600); }
  async function copy(text, label) {
    try { await navigator.clipboard.writeText(text); toast((label || "Copied") + " ✓"); }
    catch (e) { const ta = document.createElement("textarea"); ta.value = text; document.body.append(ta); ta.select(); document.execCommand("copy"); ta.remove(); toast((label || "Copied") + " ✓"); }
  }

  const rupee = n => "₹" + Number(n || 0).toLocaleString("en-IN");
  const fmtDate = t => t ? new Date(t).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—";
  function ago(t) {
    if (!t) return "Never";
    const s = (Date.now() - t) / 1000;
    if (s < 90) return "Just now"; if (s < 3600) return Math.round(s / 60) + " min ago";
    if (s < 86400) return Math.round(s / 3600) + " h ago"; if (s < 86400 * 30) return Math.round(s / 86400) + " d ago";
    return fmtDate(t);
  }
  const LABEL = { active: "Active", expired: "Expired", deactivated: "Deactivated", unused: "Not activated" };
  function pill(l) {
    if (l.status === "active" && l.daysLeft <= 7) return `<span class="pill expiring">Expires in ${l.daysLeft}d</span>`;
    return `<span class="pill ${esc(l.status)}">${esc(LABEL[l.status] || l.status)}</span>`;
  }
  const EVT = { created: "Key created", activated: "Activated", "re-activated": "Re-activated on same computer", registered: "Business registered", deactivated: "Deactivated", reactivated: "Reactivated", extended: "Extended", released: "Computer released by you", "released-by-user": "Released by customer", deleted: "Deleted", updated: "Details edited", "activate-failed": "Failed activation attempt", "admin-login-failed": "Failed admin login", "password-changed": "Admin password changed" };

  // ---------- WhatsApp messages (opened in WhatsApp with wa.me; nothing is sent automatically) ----------
  const waNum = p => { let d = String(p || "").replace(/\D/g, ""); if (d.length === 10) d = "91" + d; return d.length >= 11 ? d : ""; };
  const first = n => String(n || "").trim().split(/\s+/)[0] || "there";
  function keyMessage(l) {
    const c = l.customer || {}, len = (DAYS.find(d => d[0] === l.days) || [0, l.days + " days"])[1];
    return `Hi ${first(c.name || c.business)}, welcome to Dodail Reach! 🎉\n\nYour license key: *${l.key}*\nPlan: ${len}, counted from the day you activate it.\n\nSetup (2 minutes):\n1. Unzip the Dodail Reach file we sent you.\n2. In Chrome, open chrome://extensions and turn on *Developer mode*.\n3. Click *Load unpacked* and choose the unzipped folder.\n4. Enter your license key on the welcome page and fill in your business details.\n5. Open web.whatsapp.com — your CRM appears on the right.\n\nNeed help? Just reply here.\n– Dodail Solutions`;
  }
  function renewMessage(l) {
    const c = l.customer || {};
    const when = l.status === "expired" ? `expired on ${fmtDate(l.expiresAt)}` : `ends on ${fmtDate(l.expiresAt)} (${l.daysLeft} day${l.daysLeft === 1 ? "" : "s"} left)`;
    return `Hi ${first(c.name || c.business)}, a quick reminder from Dodail Solutions: your Dodail Reach license (${l.key}) for ${c.business || "your business"} ${when}.\n\nRenew now to keep your CRM, broadcasts and AI agent running without a break. Reply *RENEW* and we'll share the payment details.\n\nThank you!\n– Dodail Solutions`;
  }
  const waLink = (phone, text) => `https://wa.me/${waNum(phone)}?text=${encodeURIComponent(text)}`;

  // ---------- auth ----------
  function showLogin() { $("app").hidden = true; $("login").hidden = false; setTimeout(() => $("lu").focus(), 30); }
  function showApp() { $("login").hidden = true; $("app").hidden = false; }
  $("loginForm").addEventListener("submit", async e => {
    e.preventDefault(); $("lerr").hidden = true;
    const btn = e.target.querySelector("button"); btn.disabled = true;
    try { await api("login", { method: "POST", body: { user: $("lu").value.trim(), password: $("lp").value } }); $("lp").value = ""; showApp(); refresh(); }
    catch (err) { $("lerr").textContent = err.message; $("lerr").hidden = false; }
    btn.disabled = false;
  });
  $("logoutBtn").onclick = async () => { try { await api("logout", { method: "POST" }); } catch (e) { /* ignore */ } showLogin(); };

  // ---------- data ----------
  async function refresh() {
    try {
      const [st, ls] = await Promise.all([api("stats"), api("licenses?" + new URLSearchParams({ q: S.q, status: S.status }))]);
      S.stats = st.stats; S.list = ls.licenses; showApp(); render();
    } catch (e) { if ($("login").hidden) toast(e.message); }
  }
  function render() {
    const st = S.stats;
    $("sub").textContent = `${st.total} keys · ${st.active} active · ${st.onlineToday} online in the last 24 h`;
    const k = [["all", "All keys", st.total], ["active", "Active", st.active], ["online", "Online today", st.onlineToday], ["expiring", "Expiring ≤ 7 days", st.expiringSoon], ["expired", "Expired", st.expired], ["deactivated", "Deactivated", st.deactivated], ["unused", "Not activated", st.unused]];
    $("kpis").innerHTML = k.map(([id, label, n]) => `<button class="kpi k-${id}${S.status === id ? " on" : ""}" data-s="${id}" type="button" aria-pressed="${S.status === id}"><i></i><small>${esc(label)}</small><b>${n}</b></button>`).join("");
    const rv = st.revenue || { month: 0, d30: 0, total: 0 };
    const monthName = new Date().toLocaleDateString("en-IN", { month: "long" });
    $("rev").innerHTML = `<div class="rev main"><small>Revenue in ${esc(monthName)}</small><b>${rupee(rv.month)}</b></div><div class="rev"><small>Last 30 days</small><b>${rupee(rv.d30)}</b></div><div class="rev"><small>All time</small><b>${rupee(rv.total)}</b></div>`;
    $("sf").value = S.status;
    renderChart(st.activations);
    $("renewals").innerHTML = (st.renewals || []).length ? st.renewals.map(r => `<li><span><b>${esc(r.business || r.key)}</b><small>${r.daysLeft} day${r.daysLeft === 1 ? "" : "s"} left · ${esc(fmtDate(r.expiresAt))}</small></span>${waNum(r.phone) ? `<button class="btn sm wa" data-remind="${esc(r.key)}" type="button">Remind</button>` : `<button class="btn sm" data-open="${esc(r.key)}" type="button">Open</button>`}</li>`).join("") : `<li class="muted">No renewals due this week.</li>`;
    $("recent").innerHTML = st.recent.length ? st.recent.map(e => `<li><i class="dot ${esc(e.type)}"></i><span><b>${esc(EVT[e.type] || e.type)}</b>${e.key ? " · <span class='key'>" + esc(e.key) + "</span>" : ""}${e.detail && !/^[\d.:a-f]+$/i.test(e.detail) ? " · " + esc(e.detail) : ""}${e.amount ? ` · <b class="amt">${rupee(e.amount)}</b>` : ""}</span><small>${esc(ago(e.t))}</small></li>`).join("") : `<li class="muted">No activity yet. Generate your first key.</li>`;
    $("rows").innerHTML = S.list.map(l => {
      const c = l.customer || {};
      const who = c.business || c.name ? `<b>${esc(c.business || c.name)}</b><small>${esc([c.business ? c.name : "", c.phone, c.city].filter(Boolean).join(" · ") || c.email || "")}</small>` : `<small>No customer yet</small>`;
      const exp = l.status === "unused" ? `<small class="muted">${l.days} days from activation</small>` : l.expiresAt ? `${esc(fmtDate(l.expiresAt))}${l.status === "active" ? `<br><small class="muted">${l.daysLeft} days left</small>` : ""}` : "—";
      return `<tr data-k="${esc(l.key)}" tabindex="0"><td><span class="key">${esc(l.key)}</span> <button class="btn sm ghost" data-copy="${esc(l.key)}" title="Copy key" type="button">Copy</button></td>
        <td class="cust">${who}</td><td>${pill(l)}</td><td>${exp}</td>
        <td><span class="seen"><i class="${l.online ? "on" : ""}"></i>${esc(ago(l.lastSeen))}</span>${l.version ? `<small class="muted">v${esc(l.version)}</small>` : ""}</td>
        <td class="num">${l.stats ? l.stats.contacts : "—"}</td>
        <td><div class="rowact">${quickAction(l)}</div></td></tr>`;
    }).join("");
    const e = $("empty");
    e.hidden = !!S.list.length;
    e.textContent = S.q || S.status !== "all" ? "No licenses match this filter." : "No license keys yet. Click “Generate keys” to create one for your first customer.";
  }
  function quickAction(l) {
    if (l.status === "deactivated") return `<button class="btn sm" data-act="reactivate" type="button">Reactivate</button>`;
    if (l.status === "expired" || (l.status === "active" && l.daysLeft <= 7)) return `<button class="btn sm" data-act="renew" type="button">Renew</button>`;
    if (l.status === "unused") return waNum(l.customer.phone) ? `<button class="btn sm wa" data-act="sendkey" type="button">Send key</button>` : `<button class="btn sm danger" data-act="delete" type="button">Delete</button>`;
    return `<button class="btn sm danger" data-act="deactivate" type="button">Deactivate</button>`;
  }
  function renderChart(data) {
    const W = 640, H = 170, pl = 26, pb = 22, pt = 8, top = Math.max(...data.map(d => d.n)), max = Math.max(4, top + (top % 2));
    const bw = (W - pl) / data.length;
    let g = "";
    for (let i = 0; i <= 2; i++) { const v = Math.round(max * i / 2), y = H - pb - (H - pb - pt) * i / 2; g += `<line x1="${pl}" x2="${W}" y1="${y}" y2="${y}" stroke="#EEF1F6"/><text x="${pl - 6}" y="${y + 3}" text-anchor="end">${v}</text>`; }
    data.forEach((d, i) => {
      const h = (H - pb - pt) * d.n / max, x = pl + i * bw + 2;
      g += `<rect x="${x}" y="${H - pb - h}" width="${Math.max(2, bw - 4)}" height="${Math.max(d.n ? 2 : 0, h)}" rx="3" fill="#E8541A"><title>${esc(d.day)}: ${d.n} activation${d.n === 1 ? "" : "s"}</title></rect>`;
      if (i % 5 === 4 || i === data.length - 1) g += `<text x="${i === data.length - 1 ? W : x + bw / 2 - 2}" y="${H - 6}" text-anchor="${i === data.length - 1 ? "end" : "middle"}">${esc(new Date(d.day).toLocaleDateString("en-IN", { day: "numeric", month: "short" }))}</text>`;
    });
    $("chart").innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Activations per day over the last 30 days">${g}</svg>`;
  }

  // ---------- events ----------
  $("kpis").addEventListener("click", e => { const b = e.target.closest("[data-s]"); if (!b) return; S.status = b.dataset.s; refresh(); });
  $("sf").onchange = () => { S.status = $("sf").value; refresh(); };
  let qT; $("q").addEventListener("input", () => { clearTimeout(qT); qT = setTimeout(() => { S.q = $("q").value.trim(); refresh(); }, 250); });
  const findL = k => S.list.find(x => x.key === k) || null;
  async function getL(k) { return findL(k) || ((await api("licenses?" + new URLSearchParams({ q: k }))).licenses || []).find(x => x.key === k); }
  $("renewals").addEventListener("click", async e => {
    const b = e.target.closest("[data-remind],[data-open]"); if (!b) return;
    const l = await getL(b.dataset.remind || b.dataset.open); if (!l) return;
    if (b.dataset.remind) waModal(l, "renew"); else openDrawer(l);
  });
  $("rows").addEventListener("click", e => {
    const cp = e.target.closest("[data-copy]"); if (cp) { e.stopPropagation(); return copy(cp.dataset.copy, "Key copied"); }
    const tr = e.target.closest("tr[data-k]"); if (!tr) return;
    const l = findL(tr.dataset.k);
    const a = e.target.closest("[data-act]"); if (a) { e.stopPropagation(); return act(l, a.dataset.act); }
    openDrawer(l);
  });
  $("rows").addEventListener("keydown", e => { if (e.key === "Enter" && e.target.matches("tr[data-k]")) openDrawer(findL(e.target.dataset.k)); });

  async function act(l, action, extra) {
    if (!l) return;
    const name = l.customer.business || l.customer.name || l.key;
    if (action === "renew") return renewModal(l);
    if (action === "sendkey") return waModal(l, "key");
    if (action === "deactivate" && !confirm(`Deactivate ${name}? Reach stops working on their computer at its next check (within 6 hours, or when they reopen WhatsApp Web).`)) return;
    if (action === "delete") {
      if (!confirm(`Delete unused key ${l.key}? It can't be recovered.`)) return;
      try { await api("licenses/" + l.key, { method: "DELETE" }); toast("Key deleted"); closeDrawer(); refresh(); } catch (e) { toast(e.message); }
      return;
    }
    if (action === "release" && !confirm(`Release the computer for ${name}? Reach locks on the old computer at its next check, and the same key can then be activated on a new one.`)) return;
    try {
      const r = await api(`licenses/${l.key}/${action}`, { method: "POST", body: extra || {} });
      toast({ deactivate: "License deactivated", reactivate: "License reactivated", extend: "Renewed", release: "Computer released", update: "Saved" }[action] || "Done");
      await refresh();
      if (!$("drawer").hidden) openDrawer(Object.assign({}, r.license, { installId: r.license.installId ? r.license.installId.slice(0, 8) + "…" : "" }));
      return r;
    } catch (e) { toast(e.message); }
  }

  // ---------- drawer ----------
  async function openDrawer(l) {
    if (!l) return;
    const c = l.customer || {}, s = l.stats || {};
    const row = (k, v) => `<span>${esc(k)}</span><b>${v === "" || v == null ? "—" : esc(v)}</b>`;
    const canWa = !!waNum(c.phone);
    $("drawer").innerHTML = `
      <div class="dh"><div><div class="key">${esc(l.key)}</div><div class="mt6">${pill(l)} <span class="paid" id="paidTag" hidden></span></div></div><button class="btn ghost" data-close type="button" aria-label="Close">✕</button></div>
      <div class="actions">
        <button class="btn sm" data-copy="${esc(l.key)}" type="button">Copy key</button>
        ${canWa ? `<button class="btn sm wa" data-x="sendkey" type="button">Send key on WhatsApp</button>` : ""}
        <button class="btn sm" data-x="renew" type="button">Renew / extend</button>
        ${canWa && (l.status === "expired" || (l.status === "active" && l.daysLeft <= 10)) ? `<button class="btn sm wa" data-x="remind" type="button">Renewal reminder</button>` : ""}
        ${l.status === "deactivated" ? `<button class="btn sm" data-x="reactivate" type="button">Reactivate</button>` : `<button class="btn sm danger" data-x="deactivate" type="button">Deactivate</button>`}
        ${l.installId ? `<button class="btn sm" data-x="release" type="button">Release computer</button>` : ""}
        ${l.status === "unused" ? `<button class="btn sm danger" data-x="delete" type="button">Delete key</button>` : ""}
      </div>
      <div><h3 class="sh">License</h3><div class="kv">
        ${row("Plan", l.plan)}${row(l.activatedAt ? "Original plan" : "Plan length", l.days + " days")}${row("Created", fmtDate(l.createdAt))}${row("Activated", fmtDate(l.activatedAt))}
        ${row("Expires", l.expiresAt ? fmtDate(l.expiresAt) + (l.status === "active" ? ` (${l.daysLeft} days left)` : "") : "Clock starts at activation")}
        ${row("Computer", l.installId || "Not bound")}${row("Last seen", ago(l.lastSeen))}${row("Version", l.version ? "v" + l.version : "")}
      </div></div>
      <div><h3 class="sh">Usage (from last check)</h3><div class="kv">
        ${row("Category", s.category || c.category)}${row("CRM contacts", s.contacts)}${row("Sent today", s.sentToday)}${row("AI agent", s.aiMode)}
      </div></div>
      <form id="editForm"><h3 class="sh">Customer</h3><div class="fgrid">
        <label>Business<input name="business" value="${esc(c.business)}" maxlength="120"></label><label>Contact name<input name="name" value="${esc(c.name)}" maxlength="120"></label>
        <label>WhatsApp number<input name="phone" value="${esc(c.phone)}" maxlength="20" inputmode="tel"></label><label>Email<input name="email" type="email" value="${esc(c.email)}" maxlength="120"></label>
        <label>City<input name="city" value="${esc(c.city)}" maxlength="60"></label><label class="wide">Note (only you see this)<input name="note" value="${esc(l.note)}" maxlength="200" placeholder="e.g. Paid by UPI on 25 Oct"></label>
      </div><div class="mrow mt12"><button class="btn pri" type="submit">Save details</button></div></form>
      <div><h3 class="sh">History</h3><ul class="hist" id="hist"><li class="muted">Loading…</li></ul></div>`;
    $("drawer").hidden = false; $("scrim").hidden = false;
    $("drawer").onclick = e => {
      if (e.target.closest("[data-close]")) return closeDrawer();
      const cp = e.target.closest("[data-copy]"); if (cp) return copy(cp.dataset.copy, "Key copied");
      const x = e.target.closest("[data-x]"); if (!x) return;
      const v = x.dataset.x;
      if (v === "sendkey") return waModal(l, "key");
      if (v === "remind") return waModal(l, "renew");
      act(l, v);
    };
    $("editForm").onsubmit = e => { e.preventDefault(); act(l, "update", Object.fromEntries(new FormData(e.target))); };
    try {
      const h = await api(`licenses/${l.key}/history`);
      if ($("drawer").hidden || !$("hist")) return;
      $("hist").innerHTML = h.events.length ? h.events.map(ev => `<li><span><b>${esc(EVT[ev.type] || ev.type)}</b>${ev.detail ? " · " + esc(ev.detail) : ""}<small>${esc(new Date(ev.t).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }))}</small></span>${ev.amount ? `<span class="amt">${rupee(ev.amount)}</span>` : ""}</li>`).join("") : `<li class="muted">No history yet.</li>`;
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

  function renewModal(l) {
    const name = l.customer.business || l.customer.name || l.key;
    modal(`<h2>Renew ${esc(name)}</h2>
      <p class="hint">${l.status === "unused" ? "The key isn't activated yet, so the extra days are added to its plan." : l.status === "active" ? `Days are added after the current end date (${esc(fmtDate(l.expiresAt))}).` : "Days are counted from today."} This also reactivates a deactivated key.</p>
      <form id="renewForm"><div class="mtabs" role="radiogroup" aria-label="Renewal length">${DAYS.slice(0, 4).map(([d, t], i) => `<button type="button" class="chipbtn ${i === 0 ? "on" : ""}" data-days="${d}">${t}</button>`).join("")}</div>
      <div class="fgrid mt12"><label>Days to add<input name="days" type="number" min="1" max="3660" value="30" required></label><label>Amount received (₹)<input name="amount" type="number" min="0" step="1" placeholder="e.g. 999"></label></div>
      <p class="err" id="rerr" hidden></p>
      <div class="mrow mt12"><button class="btn" type="button" data-cancel>Cancel</button><button class="btn pri" type="submit">Renew</button></div></form>`);
    $("renewForm").addEventListener("click", e => { const b = e.target.closest("[data-days]"); if (!b) return; $("renewForm").querySelectorAll(".chipbtn").forEach(x => x.classList.toggle("on", x === b)); $("renewForm").days.value = b.dataset.days; });
    $("renewForm").onsubmit = async e => {
      e.preventDefault();
      const days = +e.target.days.value, amount = +e.target.amount.value || 0;
      try {
        await api(`licenses/${l.key}/extend`, { method: "POST", body: { days, amount } });
        closeModal(); toast(`Renewed +${days} days${amount ? " · " + rupee(amount) + " recorded" : ""}`); await refresh();
        if (!$("drawer").hidden) openDrawer(findL(l.key) || l);
      } catch (err) { $("rerr").textContent = err.message; $("rerr").hidden = false; }
    };
  }
  function waModal(l, kind) {
    const text = kind === "key" ? keyMessage(l) : renewMessage(l), phone = waNum(l.customer.phone);
    modal(`<h2>${kind === "key" ? "Send the key on WhatsApp" : "Send a renewal reminder"}</h2>
      <p class="hint">Opens WhatsApp with this message to ${esc(l.customer.business || l.customer.name || "the customer")} (+${esc(phone)}). Check it, then press Send.</p>
      <pre class="msgprev">${esc(text)}</pre>
      <div class="mrow"><button class="btn" type="button" id="waCopy">Copy message</button><a class="btn pri" id="waGo" href="${esc(waLink(phone, text))}" target="_blank" rel="noopener">Open WhatsApp</a></div>`);
    $("waCopy").onclick = () => copy(text, "Message copied");
    $("waGo").addEventListener("click", () => setTimeout(closeModal, 300));
  }

  $("genBtn").onclick = () => {
    modal(`<h2>Generate license keys</h2>
      <p class="hint">Each key unlocks Reach on one computer. The plan starts when the customer activates it, not today.</p>
      <form id="genForm"><div class="fgrid">
        <label>How many keys<input name="count" type="number" min="1" max="100" value="1" required></label>
        <label>Plan length<select name="days">${DAYS.map(([d, t]) => `<option value="${d}" ${d === 30 ? "selected" : ""}>${t}${d >= 30 ? ` (${d} days)` : ""}</option>`).join("")}</select></label>
        <label>Business name<input name="business" maxlength="120" placeholder="Smile Dental Care"></label><label>Contact name<input name="name" maxlength="120" placeholder="Dr. Priya"></label>
        <label>WhatsApp number<input name="phone" maxlength="20" inputmode="tel" placeholder="98xxxxxx10"></label><label>Email<input name="email" type="email" maxlength="120"></label>
        <label>City<input name="city" maxlength="60"></label><label>Plan<select name="plan"><option value="pro">AI Pro</option><option value="starter">Starter</option><option value="trial">Trial</option></select></label>
        <label>Amount received (₹)<input name="amount" type="number" min="0" step="1" placeholder="e.g. 2499"></label><label>Note<input name="note" maxlength="200" placeholder="e.g. Paid by UPI"></label>
      </div><p class="err" id="gerr" hidden></p>
      <div class="mrow mt12"><button class="btn" type="button" data-cancel>Cancel</button><button class="btn pri" type="submit">Generate</button></div></form>`);
    $("genForm").onsubmit = async e => {
      e.preventDefault();
      const b = Object.fromEntries(new FormData(e.target)); b.count = +b.count; b.days = +b.days; b.amount = +b.amount || 0;
      const btn = e.target.querySelector("button[type=submit]"); btn.disabled = true;
      try {
        const r = await api("licenses", { method: "POST", body: b });
        const all = r.keys.join("\n"), one = r.keys.length === 1;
        const fake = { key: r.keys[0], days: b.days, customer: { name: b.name, business: b.business, phone: b.phone } };
        const phone = waNum(b.phone);
        modal(`<h2>${one ? "Your new key" : r.keys.length + " new keys"}</h2>
          <p class="hint">${one && phone ? "Send it to the customer on WhatsApp with the setup steps, or copy it." : "Send each key to its customer. They enter it on Reach's welcome page."}</p>
          <div class="keys">${r.keys.map(k => `<div><span>${esc(k)}</span><button class="btn sm" data-copy="${esc(k)}" type="button">Copy</button></div>`).join("")}</div>
          <div class="mrow"><button class="btn" id="copyAll" type="button">${one ? "Copy key" : "Copy all"}</button>${one && phone ? `<a class="btn wa" href="${esc(waLink(phone, keyMessage(fake)))}" target="_blank" rel="noopener">Send on WhatsApp</a>` : ""}<button class="btn pri" type="button" data-cancel>Done</button></div>`);
        $("copyAll").onclick = () => copy(all, one ? "Key copied" : r.keys.length + " keys copied");
        $("modal").querySelectorAll("[data-copy]").forEach(b2 => { b2.onclick = () => copy(b2.dataset.copy, "Key copied"); });
        refresh();
      } catch (err) { $("gerr").textContent = err.message; $("gerr").hidden = false; btn.disabled = false; }
    };
  };

  $("settingsBtn").onclick = async () => {
    let setup; try { setup = await api("setup"); } catch (e) { return toast(e.message); }
    const origin = location.origin;
    const cfg = `// license-config.js in the extension folder\nself.REACH_LICENSE_CONFIG = {\n  server: ${JSON.stringify(origin)},\n  publicKey: ${JSON.stringify(setup.publicKey)}\n};`;
    modal(`<h2>Settings</h2>
      <div><h3 class="sh">Connect the extension to this server</h3>
      <p class="hint">This is what <b>license-config.js</b> in the Reach extension folder should contain. Licenses keep working offline for ${setup.graceDays} days after the last successful check.</p>
      <div class="code">${esc(cfg)}</div><div class="mrow mt6"><button class="btn sm" id="copyCfg" type="button">Copy config</button></div></div>
      <form id="pwForm"><h3 class="sh">Change admin password</h3><div class="fgrid">
        <label>Current password<input name="current" type="password" autocomplete="current-password" required></label>
        <label>New password (10+ characters)<input name="next" type="password" minlength="10" autocomplete="new-password" required></label>
      </div><p class="err" id="perr" hidden></p><div class="mrow mt12"><button class="btn" type="button" data-cancel>Close</button><button class="btn pri" type="submit">Change password</button></div></form>`);
    $("copyCfg").onclick = () => copy(cfg, "Config copied");
    $("pwForm").onsubmit = async e => {
      e.preventDefault();
      try { await api("password", { method: "POST", body: Object.fromEntries(new FormData(e.target)) }); closeModal(); toast("Password changed. Other sessions are signed out."); }
      catch (err) { $("perr").textContent = err.message; $("perr").hidden = false; }
    };
  };

  // ---------- boot ----------
  refresh().then(() => { if ($("app").hidden && $("login").hidden) showLogin(); });
  setInterval(() => { if (!$("app").hidden && $("modal").hidden && $("drawer").hidden && document.visibilityState === "visible") refresh(); }, 60000);
})();
