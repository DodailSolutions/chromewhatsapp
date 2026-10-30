// /admin/api/* → this one function (see vercel.json rewrites). Same endpoints as the original server,
// so the dashboard in public/admin works unchanged.
import { route, send, readJSON, ipOf, clean, cookies } from "../lib/http.js";
import { q, one, ensureSchema } from "../lib/db.js";
import { publicJwk } from "../lib/sign.js";
import { GRACE_DAYS, normKey, randomKey, fromRow, getLicense, view, event, limited } from "../lib/license.js";
import { ADMIN_USER, checkPassword, setPassword, makeSession, validSession, sessionCookie } from "../lib/auth.js";

const iso = t => t ? new Date(t).toISOString() : "";
const allLicenses = async () => (await q("SELECT * FROM licenses")).map(fromRow).map(view);

function routeOf(req) {
  const u = new URL(req.url, "http://x");
  const r = u.searchParams.get("route");
  if (r) return { path: r.replace(/^\/+/, ""), url: u };
  const m = u.pathname.match(/\/admin\/api\/(.*)$/);
  return { path: m ? m[1] : "", url: u };
}

async function stats() {
  const now = Date.now(), all = await allLicenses();
  const count = s => all.filter(l => l.status === s).length;
  const days = Array.from({ length: 30 }, (_, i) => new Date(now - (29 - i) * 864e5).toISOString().slice(0, 10));
  const act = Object.fromEntries(days.map(d => [d, 0]));
  (await q("SELECT t FROM events WHERE type = 'activated' AND t >= $1", [now - 31 * 864e5])).forEach(e => { const d = new Date(Number(e.t)).toISOString().slice(0, 10); if (d in act) act[d]++; });
  const recent = (await q("SELECT t, type, key, detail, amount FROM events ORDER BY t DESC, id DESC LIMIT 15")).map(e => ({ t: Number(e.t), type: e.type, key: e.key, detail: e.detail, amount: Number(e.amount || 0) }));
  const ist = new Date(now + 330 * 60000), monthStart = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), 1) - 330 * 60000;   // month in India time
  const rev = await one("SELECT COALESCE(SUM(amount) FILTER (WHERE t >= $1), 0)::bigint AS month, COALESCE(SUM(amount) FILTER (WHERE t >= $2), 0)::bigint AS d30, COALESCE(SUM(amount), 0)::bigint AS total FROM events", [monthStart, now - 30 * 864e5]);
  const renewals = all.filter(l => l.status === "active" && l.daysLeft <= 7).sort((a, b) => a.expiresAt - b.expiresAt).slice(0, 8)
    .map(l => ({ key: l.key, business: l.customer.business || l.customer.name, phone: l.customer.phone, daysLeft: l.daysLeft, expiresAt: l.expiresAt }));
  return {
    total: all.length, active: count("active"), expired: count("expired"), deactivated: count("deactivated"), unused: count("unused"),
    expiringSoon: all.filter(l => l.status === "active" && l.daysLeft <= 7).length,
    onlineToday: all.filter(l => l.status === "active" && l.online).length,
    activations: days.map(d => ({ day: d, n: act[d] })), recent, renewals,
    revenue: { month: Number(rev.month), d30: Number(rev.d30), total: Number(rev.total) }
  };
}

export default route(["GET", "POST", "DELETE"], async (req, res) => {
  const ip = ipOf(req), m = req.method, { path: p, url } = routeOf(req);

  if (p === "login" && m === "POST") {
    if (await limited("login", ip, 8, 15 * 60e3)) return send(res, 429, { ok: false, error: "Too many attempts. Wait 15 minutes." });
    const all = await one("SELECT n, reset FROM rate_limits WHERE k = 'login-fail-all|*'");
    if (all && Number(all.n) >= 60 && Number(all.reset) > Date.now()) return send(res, 429, { ok: false, error: "Too many failed logins. Wait 15 minutes." });
    await ensureSchema();
    const b = await readJSON(req);
    if (String(b.user || "") !== ADMIN_USER() || !(await checkPassword(b.password))) {
      await event("admin-login-failed", "", ip);
      await limited("login-fail-all", "*", 60, 15 * 60e3);          // counts failures from every IP
      return send(res, 401, { ok: false, error: "Wrong username or password." });
    }
    return send(res, 200, { ok: true }, { "set-cookie": sessionCookie(await makeSession(), req) });
  }
  if (!(await validSession(cookies(req).dr_admin))) return send(res, 401, { ok: false, error: "Please log in." });
  if (m !== "GET" && req.headers["x-requested-with"] !== "dr-admin") return send(res, 403, { ok: false, error: "Bad request origin" });   // CSRF guard

  if (p === "logout" && m === "POST") return send(res, 200, { ok: true }, { "set-cookie": sessionCookie("", req, 0) });
  if (p === "stats" && m === "GET") return send(res, 200, { ok: true, stats: await stats() });

  if (p === "licenses" && m === "GET") {
    const term = (url.searchParams.get("q") || "").toLowerCase(), s = url.searchParams.get("status") || "all";
    let list = await allLicenses();
    if (s !== "all") list = list.filter(l => s === "online" ? l.status === "active" && l.online : s === "expiring" ? l.status === "active" && l.daysLeft <= 7 : l.status === s);
    if (term) list = list.filter(l => [l.key, l.customer.business, l.customer.name, l.customer.phone, l.customer.email, l.customer.city, l.note].join(" ").toLowerCase().includes(term));
    list.sort((a, b) => (b.lastSeen || b.createdAt) - (a.lastSeen || a.createdAt));
    return send(res, 200, { ok: true, licenses: list.map(l => Object.assign({}, l, { installId: l.installId ? l.installId.slice(0, 8) + "…" : "", ip: undefined })) });
  }

  if (p === "licenses" && m === "POST") {
    const b = await readJSON(req);
    const count = Math.max(1, Math.min(100, +b.count || 1)), days = Math.max(1, Math.min(3660, +b.days || 30));
    const customer = { business: clean(b.business), name: clean(b.name), phone: clean(b.phone, 20), email: clean(b.email), city: clean(b.city, 60), category: "" };
    const out = [];
    while (out.length < count) {
      const key = randomKey();
      const r = await one(`INSERT INTO licenses (key, plan, days, created_at, note, customer) VALUES ($1, $2, $3, $4, $5, $6::jsonb) ON CONFLICT (key) DO NOTHING RETURNING key`,
        [key, clean(b.plan, 20) || "pro", days, Date.now(), clean(b.note, 200), JSON.stringify(customer)]);
      if (r) { out.push(key); await event("created", key, `${days} days`, out.length === 1 ? b.amount : 0); }
    }
    return send(res, 200, { ok: true, keys: out });
  }

  const hm = p.match(/^licenses\/(DR-[A-Z0-9-]{19})\/history$/);
  if (hm && m === "GET") {
    const ev = await q("SELECT t, type, detail, amount FROM events WHERE key = $1 ORDER BY t DESC, id DESC LIMIT 50", [normKey(hm[1])]);
    const paid = ev.reduce((s, e) => s + Number(e.amount || 0), 0);
    return send(res, 200, { ok: true, paid, events: ev.map(e => ({ t: Number(e.t), type: e.type, detail: /^[\d.:a-f]+$/i.test(e.detail) ? "" : e.detail, amount: Number(e.amount || 0) })) });
  }
  const mm = p.match(/^licenses\/(DR-[A-Z0-9-]{19})(?:\/(deactivate|reactivate|extend|release|update))?$/);
  if (mm) {
    const l = await getLicense(normKey(mm[1])); if (!l) return send(res, 404, { ok: false, error: "License not found" });
    const action = mm[2], biz = l.customer.business;
    if (m === "DELETE" && !action) {
      if (l.activatedAt) return send(res, 400, { ok: false, error: "Only unused keys can be deleted. Deactivate it instead." });
      await q("DELETE FROM licenses WHERE key = $1 AND activated_at = 0", [l.key]); await event("deleted", l.key);
      return send(res, 200, { ok: true });
    }
    if (m !== "POST") return send(res, 405, { ok: false, error: "Method not allowed" });
    const b = await readJSON(req);
    let row;
    if (action === "deactivate") { row = await one("UPDATE licenses SET revoked = true WHERE key = $1 RETURNING *", [l.key]); await event("deactivated", l.key, biz); }
    else if (action === "reactivate") { row = await one("UPDATE licenses SET revoked = false WHERE key = $1 RETURNING *", [l.key]); await event("reactivated", l.key, biz); }
    else if (action === "release") { row = await one("UPDATE licenses SET install_id = '' WHERE key = $1 RETURNING *", [l.key]); await event("released", l.key, biz); }
    else if (action === "extend") {
      const d = Math.round(+b.days || 30);
      if (!(d >= 1 && d <= 3660)) return send(res, 400, { ok: false, error: "Days must be between 1 and 3660." });
      row = await one(`UPDATE licenses SET revoked = false,
          days = CASE WHEN activated_at = 0 THEN days + $2 ELSE days END,
          expires_at = CASE WHEN activated_at = 0 THEN expires_at ELSE GREATEST(expires_at, $3) + $2::bigint * 86400000 END
        WHERE key = $1 RETURNING *`, [l.key, d, Date.now()]);
      await event("extended", l.key, `+${d} days`, b.amount);
    } else if (action === "update") {
      const c = Object.assign({}, l.customer);
      ["business", "name", "phone", "email", "city"].forEach(f => { if (b[f] !== undefined) c[f] = clean(b[f]); });
      row = await one("UPDATE licenses SET customer = $2::jsonb, note = $3 WHERE key = $1 RETURNING *", [l.key, JSON.stringify(c), b.note !== undefined ? clean(b.note, 200) : l.note]);
      await event("updated", l.key);
    } else return send(res, 404, { ok: false, error: "Not found" });
    return send(res, 200, { ok: true, license: view(fromRow(row)) });
  }

  if (p === "export.csv" && m === "GET") {
    const rows = [["key", "status", "business", "name", "phone", "email", "city", "category", "plan", "days", "created", "activated", "expires", "last_seen", "version", "contacts", "note"]];
    (await allLicenses()).forEach(l => rows.push([l.key, l.status, l.customer.business, l.customer.name, l.customer.phone, l.customer.email, l.customer.city, l.customer.category, l.plan, l.days, iso(l.createdAt), iso(l.activatedAt), iso(l.expiresAt), iso(l.lastSeen), l.version, l.stats?.contacts ?? "", l.note]));
    const csv = rows.map(r => r.map(v => { v = String(v ?? ""); if (/^[=+\-@\t\r]/.test(v)) v = "'" + v; return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; }).join(",")).join("\n");
    return send(res, 200, csv, { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="dodail-reach-licenses-${new Date().toISOString().slice(0, 10)}.csv"` });
  }
  if (p === "setup" && m === "GET") return send(res, 200, { ok: true, publicKey: publicJwk(), graceDays: GRACE_DAYS, user: ADMIN_USER() });
  if (p === "password" && m === "POST") {
    const b = await readJSON(req);
    if (!(await checkPassword(b.current))) return send(res, 400, { ok: false, error: "Current password is wrong." });
    if (String(b.next || "").length < 10) return send(res, 400, { ok: false, error: "Use at least 10 characters." });
    await setPassword(String(b.next)); await event("password-changed", "", ip);
    return send(res, 200, { ok: true }, { "set-cookie": sessionCookie(await makeSession(), req) });
  }
  send(res, 404, { ok: false, error: "Not found" });
});
