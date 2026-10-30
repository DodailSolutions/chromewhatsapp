// /admin/api/* → this one function (see vercel.json rewrites).
import { route, send, readJSON, ipOf, clean, cookies } from "../lib/http.js";
import { q, one, ensureSchema } from "../lib/db.js";
import { publicJwk } from "../lib/sign.js";
import { GRACE_DAYS, normKey, randomKey, fromRow, getLicense, view, event, limited } from "../lib/license.js";
import { supa, signIn, forgotPassword, setPasswordWithToken, invite, updateAdmin, listAdmins, makeSession, sessionUser, sessionCookie, checkLegacyPassword, setLegacyPassword } from "../lib/auth.js";
import { DEFAULTS, getSetting, setSetting, listPlans, getPlan, addPayment, listPayments, getPayment } from "../lib/store.js";

const iso = t => t ? new Date(t).toISOString() : "";
const allLicenses = async () => (await q("SELECT * FROM licenses")).map(fromRow).map(view);
const originOf = req => (req.headers["x-forwarded-proto"] || (process.env.VERCEL ? "https" : "http")) + "://" + (req.headers["x-forwarded-host"] || req.headers.host);
const csvOut = rows => rows.map(r => r.map(v => { v = String(v ?? ""); if (/^[=+\-@\t\r]/.test(v)) v = "'" + v; return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; }).join(",")).join("\n");
const dayIST = t => new Date(t + 330 * 60000).toISOString().slice(0, 10);

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
  const days = Array.from({ length: 30 }, (_, i) => dayIST(now - (29 - i) * 864e5));
  const act = Object.fromEntries(days.map(d => [d, 0])), rev = Object.fromEntries(days.map(d => [d, 0]));
  (await q("SELECT t FROM events WHERE type IN ('activated','trial-started') AND t >= $1", [now - 31 * 864e5])).forEach(e => { const d = dayIST(Number(e.t)); if (d in act) act[d]++; });
  const pays = await q("SELECT amount, paid_at FROM payments WHERE paid_at >= $1", [now - 400 * 864e5]);
  pays.forEach(p => { const d = dayIST(Number(p.paid_at)); if (d in rev) rev[d] += Number(p.amount); });
  const ist = new Date(now + 330 * 60000), monthStart = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), 1) - 330 * 60000;
  const total = await one("SELECT COALESCE(SUM(amount),0)::bigint AS s, count(*)::int AS n FROM payments");
  const sum = from => pays.filter(p => Number(p.paid_at) >= from).reduce((s, p) => s + Number(p.amount), 0);
  const recent = (await q("SELECT t, type, key, detail, amount, actor FROM events ORDER BY t DESC, id DESC LIMIT 15")).map(e => ({ t: Number(e.t), type: e.type, key: e.key, detail: e.detail, amount: Number(e.amount || 0), actor: e.actor }));
  const renewals = all.filter(l => l.status === "active" && l.daysLeft <= 7).sort((a, b) => a.expiresAt - b.expiresAt).slice(0, 8)
    .map(l => ({ key: l.key, business: l.customer.business || l.customer.name, phone: l.customer.phone, daysLeft: l.daysLeft, expiresAt: l.expiresAt, trial: l.trial }));
  const trials = all.filter(l => l.trial), paidKeys = new Set((await q("SELECT DISTINCT key FROM payments")).map(r => r.key));
  const trialKeys = (await q("SELECT key FROM trials")).map(r => r.key);
  const paying = all.filter(l => l.status === "active" && !l.trial);
  return {
    total: all.length, active: count("active"), expired: count("expired"), deactivated: count("deactivated"), unused: count("unused"),
    expiringSoon: all.filter(l => l.status === "active" && l.daysLeft <= 7).length,
    onlineToday: all.filter(l => l.status === "active" && l.online).length,
    trialsActive: trials.filter(l => l.status === "active").length, trialsTotal: trialKeys.length, trialsConverted: trialKeys.filter(k => paidKeys.has(k)).length,
    payingActive: paying.length,
    activations: days.map(d => ({ day: d, n: act[d] })), revenueDaily: days.map(d => ({ day: d, amount: rev[d] })), recent, renewals,
    revenue: { month: sum(monthStart), d30: sum(now - 30 * 864e5), total: Number(total.s), payments: Number(total.n) }
  };
}

const staffBlocked = new Set(["team", "settings-put", "plans-write", "delete-key", "password"]);

export default route(["GET", "POST", "PUT", "DELETE"], async (req, res) => {
  const ip = ipOf(req), m = req.method, { path: p, url } = routeOf(req);
  const ok = (body = {}) => send(res, 200, Object.assign({ ok: true }, body));
  const bad = (msg, code = 400) => send(res, code, { ok: false, error: msg });

  // ---------- public: sign in, forgot, reset ----------
  if (p === "auth-mode" && m === "GET") return ok({ mode: supa() ? "supabase" : "password" });
  if (p === "login" && m === "POST") {
    await ensureSchema().catch(() => {});
    if (await limited("login", ip, 8, 15 * 60e3)) return bad("Too many attempts. Wait 15 minutes.", 429);
    const all = await one("SELECT n, reset FROM rate_limits WHERE k = 'login-fail-all|*'").catch(() => null);
    if (all && Number(all.n) >= 60 && Number(all.reset) > Date.now()) return bad("Too many failed sign-ins. Wait 15 minutes.", 429);
    const b = await readJSON(req);
    let who;
    try { who = await signIn(b.user, b.password); }
    catch (e) {
      await event("admin-login-failed", "", ip).catch(() => {});
      await limited("login-fail-all", "*", 60, 15 * 60e3).catch(() => {});
      return bad(e.message, 401);
    }
    await event("admin-login", "", "", 0, who.email).catch(() => {});
    return send(res, 200, { ok: true, user: who }, { "set-cookie": sessionCookie(await makeSession(who), req) });
  }
  if (p === "forgot" && m === "POST") {
    await ensureSchema().catch(() => {});
    if (await limited("forgot", ip, 5, 3600e3)) return bad("Too many requests. Try again later.", 429);
    const b = await readJSON(req);
    if (!b?.email) return bad("Please enter your email.");
    try { await forgotPassword(b.email, originOf(req) + "/admin"); } catch (e) { return bad(e.message); }
    return ok({ message: "If that email is on the team, a reset link is on its way." });
  }
  if (p === "reset" && m === "POST") {
    await ensureSchema().catch(() => {});
    if (await limited("reset", ip, 10, 3600e3)) return bad("Too many attempts. Try again later.", 429);
    const b = await readJSON(req);
    let who; try { who = await setPasswordWithToken(b.accessToken, b.password); } catch (e) { return bad(e.message); }
    await event("password-set", "", "", 0, who.email);
    return send(res, 200, { ok: true, user: who }, { "set-cookie": sessionCookie(await makeSession(who), req) });
  }

  // ---------- everything below needs a session ----------
  const me = await sessionUser(cookies(req).dr_admin);
  if (!me) return bad("Please sign in.", 401);
  if (m !== "GET" && req.headers["x-requested-with"] !== "dr-admin") return bad("Bad request origin", 403);   // CSRF guard
  const ownerOnly = what => { if (me.role !== "owner" && staffBlocked.has(what)) { bad("Only an owner can do this.", 403); return true; } return false; };

  if (p === "logout" && m === "POST") return send(res, 200, { ok: true }, { "set-cookie": sessionCookie("", req, 0) });
  if (p === "me" && m === "GET") return ok({ user: me, mode: supa() ? "supabase" : "password" });
  if (p === "stats" && m === "GET") return ok({ stats: await stats() });

  // ---------- licenses ----------
  if (p === "licenses" && m === "GET") {
    const term = (url.searchParams.get("q") || "").toLowerCase(), s = url.searchParams.get("status") || "all";
    let list = await allLicenses();
    const f = {
      all: () => true, online: l => l.status === "active" && l.online, expiring: l => l.status === "active" && l.daysLeft <= 7,
      trial: l => l.trial, paid: l => !l.trial && l.status === "active", starter: l => l.tier === "starter", pro: l => l.tier === "pro" && !l.trial
    }[s] || (l => l.status === s);
    list = list.filter(f);
    if (term) list = list.filter(l => [l.key, l.customer.business, l.customer.name, l.customer.phone, l.customer.email, l.customer.city, l.note, l.plan].join(" ").toLowerCase().includes(term));
    list.sort((a, b) => (b.lastSeen || b.createdAt) - (a.lastSeen || a.createdAt));
    return ok({ licenses: list.map(l => Object.assign({}, l, { installId: l.installId ? l.installId.slice(0, 8) + "…" : "", ip: undefined })) });
  }
  if (p === "licenses" && m === "POST") {
    const b = await readJSON(req);
    const plan = await getPlan(b.planId);
    const count = Math.max(1, Math.min(100, +b.count || 1));
    const days = plan ? plan.days : Math.round(+b.days || 30);
    if (!(days >= 1 && days <= 3660)) return bad("Days must be between 1 and 3660.");
    const customer = { business: clean(b.business), name: clean(b.name), phone: clean(b.phone, 20), email: clean(b.email), city: clean(b.city, 60), category: "" };
    const tier = plan ? plan.tier : (b.plan === "starter" ? "starter" : "pro");
    const out = [];
    while (out.length < count) {
      const key = randomKey();
      const r = await one(`INSERT INTO licenses (key, plan, plan_id, tier, days, created_at, note, customer) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb) ON CONFLICT (key) DO NOTHING RETURNING key`,
        [key, plan ? plan.name : clean(b.plan, 40) || "AI Pro", plan ? plan.id : "", tier, days, Date.now(), clean(b.note, 200), JSON.stringify(customer)]);
      if (r) { out.push(key); await event("created", key, `${plan ? plan.name : days + " days"}`, 0, me.email); }
    }
    let payment = null;
    if (+b.amount > 0) payment = await addPayment({ key: out[0], plan, days, amount: b.amount, method: b.method, reference: b.reference, note: b.note, customer, actor: me.email });
    return ok({ keys: out, payment });
  }

  const hm = p.match(/^licenses\/(DR-[A-Z0-9-]{19})\/history$/);
  if (hm && m === "GET") {
    const key = normKey(hm[1]);
    const ev = await q("SELECT t, type, detail, actor FROM events WHERE key = $1 ORDER BY t DESC, id DESC LIMIT 60", [key]);
    const pays = await listPayments({ key });
    return ok({ paid: pays.reduce((s, x) => s + x.amount, 0), payments: pays, events: ev.map(e => ({ t: Number(e.t), type: e.type, detail: /^[\d.:a-f]+$/i.test(e.detail) ? "" : e.detail, actor: e.actor })) });
  }
  const mm = p.match(/^licenses\/(DR-[A-Z0-9-]{19})(?:\/(deactivate|reactivate|extend|release|update))?$/);
  if (mm) {
    const l = await getLicense(normKey(mm[1])); if (!l) return bad("License not found", 404);
    const action = mm[2], biz = l.customer.business;
    if (m === "DELETE" && !action) {
      if (ownerOnly("delete-key")) return;
      if (l.activatedAt) return bad("Only unused keys can be deleted. Deactivate it instead.");
      await q("DELETE FROM licenses WHERE key = $1 AND activated_at = 0", [l.key]); await event("deleted", l.key, "", 0, me.email);
      return ok();
    }
    if (m !== "POST") return bad("Method not allowed", 405);
    const b = await readJSON(req);
    let row, payment = null;
    if (action === "deactivate") { row = await one("UPDATE licenses SET revoked = true WHERE key = $1 RETURNING *", [l.key]); await event("deactivated", l.key, biz, 0, me.email); }
    else if (action === "reactivate") { row = await one("UPDATE licenses SET revoked = false WHERE key = $1 RETURNING *", [l.key]); await event("reactivated", l.key, biz, 0, me.email); }
    else if (action === "release") { row = await one("UPDATE licenses SET install_id = '' WHERE key = $1 RETURNING *", [l.key]); await event("released", l.key, biz, 0, me.email); }
    else if (action === "extend") {
      const plan = await getPlan(b.planId);
      const d = plan ? plan.days : Math.round(+b.days || 30);
      if (!(d >= 1 && d <= 3660)) return bad("Days must be between 1 and 3660.");
      // A paid plan on a trial key turns it into a normal license (keeps the same key and computer).
      row = await one(`UPDATE licenses SET revoked = false,
          days = CASE WHEN activated_at = 0 THEN days + $2 ELSE days END,
          expires_at = CASE WHEN activated_at = 0 THEN expires_at ELSE GREATEST(expires_at, $3) + $2::bigint * 86400000 END,
          plan = COALESCE($4, plan), plan_id = COALESCE($5, plan_id), tier = COALESCE($6, tier), trial = CASE WHEN $4 IS NULL THEN trial ELSE false END
        WHERE key = $1 RETURNING *`, [l.key, d, Date.now(), plan ? plan.name : null, plan ? plan.id : null, plan ? plan.tier : null]);
      await event(l.trial && plan ? "converted" : "extended", l.key, `${plan ? plan.name : ""} +${d} days`.trim(), 0, me.email);
      if (+b.amount > 0) payment = await addPayment({ key: l.key, plan, days: d, amount: b.amount, method: b.method, reference: b.reference, note: b.note, customer: l.customer, actor: me.email });
    } else if (action === "update") {
      const c = Object.assign({}, l.customer);
      ["business", "name", "phone", "email", "city"].forEach(f => { if (b[f] !== undefined) c[f] = clean(b[f], f === "phone" ? 20 : 120); });
      row = await one("UPDATE licenses SET customer = $2::jsonb, note = $3 WHERE key = $1 RETURNING *", [l.key, JSON.stringify(c), b.note !== undefined ? clean(b.note, 200) : l.note]);
      await event("updated", l.key, "", 0, me.email);
    } else return bad("Not found", 404);
    return ok({ license: view(fromRow(row)), payment });
  }

  // ---------- payments + receipts ----------
  if (p === "payments" && m === "GET") {
    const pays = await listPayments({ limit: 1000 });
    return ok({ payments: pays, total: pays.reduce((s, x) => s + x.amount, 0) });
  }
  const pm = p.match(/^payments\/(\d+)$/);
  if (pm && m === "GET") {
    const pay = await getPayment(+pm[1]); if (!pay) return bad("Receipt not found", 404);
    const lic = await getLicense(pay.key);
    return ok({ payment: pay, license: lic ? view(lic) : null, company: await getSetting("company") });
  }

  // ---------- plans ----------
  if (p === "plans" && m === "GET") return ok({ plans: await listPlans(false) });
  if (p === "plans" && (m === "POST" || m === "PUT")) {
    if (ownerOnly("plans-write")) return;
    const b = await readJSON(req);
    const id = String(b.id || "").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 40) || (String(b.tier || "pro") + "-" + Math.round(+b.days || 30) + "d-" + Date.now().toString(36).slice(-4));
    const days = Math.round(+b.days), price = Math.round(+b.price);
    if (!clean(b.name)) return bad("Give the plan a name.");
    if (!(days >= 1 && days <= 3660)) return bad("Plan length must be 1 to 3660 days.");
    if (!(price >= 0 && price <= 10000000)) return bad("Enter a valid price.");
    await q(`INSERT INTO plans (id, name, tier, days, price, features, active, sort) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, tier = EXCLUDED.tier, days = EXCLUDED.days, price = EXCLUDED.price, features = EXCLUDED.features, active = EXCLUDED.active, sort = EXCLUDED.sort`,
      [id, clean(b.name, 60), b.tier === "starter" ? "starter" : "pro", days, price, clean(b.features, 300), b.active !== false, Math.round(+b.sort || 0)]);
    await event("plan-saved", "", `${clean(b.name, 60)} · ₹${price} · ${days} days`, 0, me.email);
    return ok({ plans: await listPlans(false) });
  }

  // ---------- team ----------
  if (p === "team" && m === "GET") return ok({ team: await listAdmins(), mode: supa() ? "supabase" : "password", me });
  if (p === "team" && m === "POST") {
    if (ownerOnly("team")) return;
    if (!supa()) return bad("Connect Supabase (SUPABASE_URL and keys in Vercel) to add team members.");
    const b = await readJSON(req);
    let note; try { note = await invite(b.email, clean(b.name, 80), b.role, originOf(req) + "/admin"); } catch (e) { return bad(e.message); }
    await event("team-invited", "", `${clean(b.email)} · ${b.role === "owner" ? "owner" : "staff"}`, 0, me.email);
    return ok({ note, team: await listAdmins() });
  }
  const tm = p.match(/^team\/(.+)$/);
  if (tm && m === "POST") {
    if (ownerOnly("team")) return;
    const b = await readJSON(req), email = decodeURIComponent(tm[1]).toLowerCase();
    if (email === me.email && (b.active === false || b.role === "staff")) return bad("You can't remove or demote yourself.");
    try { await updateAdmin(email, { role: b.role, active: b.active, name: b.name }); } catch (e) { return bad(e.message); }
    await event(b.active === false ? "team-removed" : "team-updated", "", email, 0, me.email);
    return ok({ team: await listAdmins() });
  }

  // ---------- settings ----------
  if (p === "settings" && m === "GET") {
    const [trial, update, company, sales] = await Promise.all(Object.keys(DEFAULTS).map(getSetting));
    return ok({ trial, update, company, sales, publicKey: publicJwk(), graceDays: GRACE_DAYS, mode: supa() ? "supabase" : "password" });
  }
  const sm = p.match(/^settings\/(trial|update|company|sales)$/);
  if (sm && m === "POST") {
    if (ownerOnly("settings-put")) return;
    const b = await readJSON(req), k = sm[1];
    let v;
    if (k === "trial") v = { enabled: !!b.enabled, days: Math.max(1, Math.min(30, Math.round(+b.days || 7))), tier: b.tier === "starter" ? "starter" : "pro" };
    else if (k === "update") {
      if (b.version && !/^\d+\.\d+(\.\d+)?$/.test(String(b.version).trim())) return bad("Version looks like 0.9.0.");
      if (b.url && !/^https:\/\//.test(String(b.url).trim())) return bad("Download link must start with https://");
      v = { version: clean(b.version, 20), url: clean(b.url, 300), notes: clean(b.notes, 300) };
    } else if (k === "company") v = Object.fromEntries(["name", "address", "gstin", "email", "phone", "website", "footer"].map(f => [f, clean(b[f], f === "address" || f === "footer" ? 240 : 120)]));
    else v = { whatsapp: String(b.whatsapp || "").replace(/\D/g, "").slice(0, 15), buyUrl: /^https:\/\//.test(String(b.buyUrl || "")) ? clean(b.buyUrl, 300) : "" };
    await setSetting(k, v); await event("settings-saved", "", k, 0, me.email);
    return ok({ [k]: await getSetting(k) });
  }
  if (p === "password" && m === "POST") {
    if (ownerOnly("password")) return;
    if (supa()) return bad("Use “Forgot password” on the sign-in page to change a Supabase password.");
    const b = await readJSON(req);
    if (!(await checkLegacyPassword(b.current))) return bad("Current password is wrong.");
    if (String(b.next || "").length < 10) return bad("Use at least 10 characters.");
    await setLegacyPassword(String(b.next)); await event("password-changed", "", ip, 0, me.email);
    return send(res, 200, { ok: true }, { "set-cookie": sessionCookie(await makeSession(me), req) });
  }

  // ---------- exports ----------
  if (p === "export.csv" && m === "GET") {
    const rows = [["key", "status", "plan", "tier", "trial", "business", "name", "phone", "email", "city", "category", "days", "created", "activated", "expires", "last_seen", "version", "contacts", "terms_accepted", "note"]];
    (await allLicenses()).forEach(l => rows.push([l.key, l.status, l.plan, l.tier, l.trial ? "yes" : "", l.customer.business, l.customer.name, l.customer.phone, l.customer.email, l.customer.city, l.customer.category, l.days, iso(l.createdAt), iso(l.activatedAt), iso(l.expiresAt), iso(l.lastSeen), l.version, l.stats?.contacts ?? "", iso(l.termsAt), l.note]));
    return send(res, 200, csvOut(rows), { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="dodail-reach-licenses-${dayIST(Date.now())}.csv"` });
  }
  if (p === "payments.csv" && m === "GET") {
    const rows = [["receipt_no", "date", "key", "business", "plan", "days", "amount_inr", "method", "reference", "recorded_by", "note"]];
    (await listPayments({ limit: 2000 })).forEach(x => rows.push([x.receiptNo, iso(x.paidAt), x.key, x.customer.business || x.customer.name || "", x.planName, x.days, x.amount, x.method, x.reference, x.actor, x.note]));
    return send(res, 200, csvOut(rows), { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="dodail-reach-payments-${dayIST(Date.now())}.csv"` });
  }
  send(res, 404, { ok: false, error: "Not found" });
});
