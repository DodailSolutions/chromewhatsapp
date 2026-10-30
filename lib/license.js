// License rules: key format, status, row mapping, events, rate limits.
import crypto from "node:crypto";
import { q, one, ensureSchema } from "./db.js";
import { sign } from "./sign.js";

export const GRACE_DAYS = +process.env.GRACE_DAYS || 7;
const ALPH = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";          // no 0/O/1/I

export function normKey(k) {
  let s = String(k || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (s.length === 18 && s.startsWith("DR")) s = s.slice(2);
  return "DR-" + s.replace(/(.{4})(?=.)/g, "$1-");
}
export function randomKey() {
  const bytes = crypto.randomBytes(16);
  return "DR-" + [0, 1, 2, 3].map(g => Array.from({ length: 4 }, (_, i) => ALPH[bytes[g * 4 + i] % 32]).join("")).join("-");
}

const num = v => Number(v || 0);
// jsonb arrives parsed from Supabase, but some drivers hand back text: accept both.
export const json = (v, d = null) => { if (v == null) return d; if (typeof v === "string") { try { return JSON.parse(v); } catch (e) { return d; } } return v; };
export function fromRow(r) {
  if (!r) return null;
  return {
    key: r.key, plan: r.plan, planId: r.plan_id || "", tier: r.tier || (r.plan === "starter" ? "starter" : "pro"), trial: !!r.trial,
    days: num(r.days), createdAt: num(r.created_at), activatedAt: num(r.activated_at), expiresAt: num(r.expires_at),
    revoked: !!r.revoked, installId: r.install_id || "", note: r.note || "",
    customer: Object.assign({ business: "", name: "", phone: "", email: "", city: "", category: "" }, json(r.customer, {})),
    lastSeen: num(r.last_seen), version: r.version || "", ip: r.ip || "", stats: json(r.stats, null), termsAt: num(r.terms_at)
  };
}
export const getLicense = async key => fromRow(await one("SELECT * FROM licenses WHERE key = $1", [key]));

export function statusOf(l, now = Date.now()) {
  if (l.revoked) return "deactivated";
  if (!l.activatedAt) return "unused";
  if (l.expiresAt <= now) return "expired";
  return "active";
}
export function view(l) {
  const now = Date.now(), s = statusOf(l, now);
  return Object.assign({}, l, { status: s, daysLeft: s === "active" ? Math.ceil((l.expiresAt - now) / 864e5) : 0, online: !!l.lastSeen && now - l.lastSeen < 864e5 });
}
// What the extension verifies. tier decides which features unlock (starter = no AI agent).
export function signedFor(l, installId) {
  return sign({ v: 1, key: l.key, installId, status: statusOf(l), plan: l.plan, tier: l.tier === "starter" ? "starter" : "pro", trial: !!l.trial, expiresAt: l.expiresAt || 0, issuedAt: Date.now(), graceDays: GRACE_DAYS, business: l.customer.business || "" });
}

export async function event(type, key, detail, amount = 0, actor = "") {
  try {
    const amt = Math.max(0, Math.min(10000000, Math.round(+amount || 0)));
    await q("INSERT INTO events (t, type, key, detail, amount, actor) VALUES ($1, $2, $3, $4, $5, $6)", [Date.now(), type, key || "", String(detail || "").slice(0, 300), amt, String(actor || "").slice(0, 120)]);
  } catch (e) { /* logging should never crash the caller */ }
}

// Returns true when the caller is over the limit. One atomic upsert per call.
export async function limited(name, ip, max, windowMs) {
  try {
    const now = Date.now();
    const r = await one(
      `INSERT INTO rate_limits (k, n, reset) VALUES ($1, 1, $2)
       ON CONFLICT (k) DO UPDATE SET
         n = CASE WHEN rate_limits.reset < $3 THEN 1 ELSE rate_limits.n + 1 END,
         reset = CASE WHEN rate_limits.reset < $3 THEN $2 ELSE rate_limits.reset END
       RETURNING n`, [name + "|" + ip, now + windowMs, now]);
    if (Math.random() < 0.01) q("DELETE FROM rate_limits WHERE reset < $1", [now]).catch(() => {});   // occasional cleanup
    return Number(r?.n || 0) > max;
  } catch (e) {
    if (/rate_limits|relation.*does not exist/i.test(e?.message || "")) {
      await ensureSchema().catch(() => {});
      try {
        const now = Date.now();
        const r = await one(
          `INSERT INTO rate_limits (k, n, reset) VALUES ($1, 1, $2)
           ON CONFLICT (k) DO UPDATE SET
             n = CASE WHEN rate_limits.reset < $3 THEN 1 ELSE rate_limits.n + 1 END,
             reset = CASE WHEN rate_limits.reset < $3 THEN $2 ELSE rate_limits.reset END
           RETURNING n`, [name + "|" + ip, now + windowMs, now]);
        return Number(r?.n || 0) > max;
      } catch (err) { /* ignore */ }
    }
    // If rate limiting store is unreachable, fail open rather than crashing with 500
    return false;
  }
}
