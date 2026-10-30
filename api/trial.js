// POST /api/trial {installId, customer, version, termsAt} — starts a free trial from Reach's welcome page.
// One trial per computer, per WhatsApp number and per email. The trial key is activated on this computer at once.
import { route, send, readJSON, ipOf, clean, CORS } from "../lib/http.js";
import { q, one, ensureSchema } from "../lib/db.js";
import { randomKey, signedFor, event, limited, fromRow } from "../lib/license.js";
import { getSetting, clientExtras } from "../lib/store.js";

const digits = p => { let d = String(p || "").replace(/\D/g, ""); if (d.length === 10) d = "91" + d; return d; };

export default route(["POST"], async (req, res) => {
  await ensureSchema();
  const ip = ipOf(req);
  if (await limited("trial", ip, 5, 24 * 3600e3)) return send(res, 429, { ok: false, error: "Too many trials from this network today. Contact Dodail Solutions." }, CORS);
  const t = await getSetting("trial");
  if (!t.enabled) return send(res, 403, { ok: false, error: "Free trials are paused right now. Contact Dodail Solutions for a license key.", status: "trial-off" }, CORS);
  const b = await readJSON(req), installId = clean(b.installId, 64), c = b.customer || {};
  const customer = { business: clean(c.business), name: clean(c.name), phone: clean(c.phone, 20), email: clean(c.email).toLowerCase(), city: clean(c.city, 60), category: clean(c.category, 30) };
  const phone = digits(customer.phone);
  if (!installId || phone.length < 11 || !/^\S+@\S+\.\S+$/.test(customer.email) || !customer.business) return send(res, 400, { ok: false, error: "Add your business name, WhatsApp number and email to start the trial." }, CORS);
  const used = await one("SELECT key FROM trials WHERE install_id = $1 OR phone = $2 OR email = $3 LIMIT 1", [installId, phone, customer.email]);
  if (used) return send(res, 409, { ok: false, error: "A free trial was already used on this computer, number or email. Choose a plan to continue.", status: "trial-used" }, CORS);
  const days = Math.max(1, Math.min(30, +t.days || 7)), now = Date.now();
  let row = null;
  for (let i = 0; i < 5 && !row; i++) {
    row = await one(`INSERT INTO licenses (key, plan, plan_id, tier, trial, days, created_at, activated_at, expires_at, install_id, customer, last_seen, version, ip, terms_at, note)
      VALUES ($1,'trial','trial',$2,true,$3,$4,$4,$5,$6,$7::jsonb,$4,$8,$9,$10,'Free trial (self-serve)') ON CONFLICT (key) DO NOTHING RETURNING *`,
      [randomKey(), t.tier === "starter" ? "starter" : "pro", days, now, now + days * 864e5, installId, JSON.stringify(customer), clean(b.version, 20), ip, Math.min(now, +b.termsAt || 0)]);
  }
  const lic = fromRow(row);
  try { await q("INSERT INTO trials (install_id, phone, email, key, t) VALUES ($1,$2,$3,$4,$5)", [installId, phone, customer.email, lic.key, now]); }
  catch (e) { await q("DELETE FROM licenses WHERE key = $1", [lic.key]); return send(res, 409, { ok: false, error: "A free trial was already used on this computer, number or email.", status: "trial-used" }, CORS); }
  await event("trial-started", lic.key, `${customer.business} · ${days} days`);
  send(res, 200, Object.assign({ ok: true, key: lic.key, license: signedFor(lic, installId) }, await clientExtras()), CORS);
}, { cors: true });
