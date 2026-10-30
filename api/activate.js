// POST /api/activate {key, installId, customer, version} — binds a key to one Reach install.
// The 30-day (or plan) clock starts on the first activation.
import { route, send, readJSON, ipOf, clean, CORS } from "../lib/http.js";
import { q, one, ensureSchema } from "../lib/db.js";
import { normKey, getLicense, signedFor, event, limited, fromRow } from "../lib/license.js";
import { clientExtras } from "../lib/store.js";

export default route(["POST"], async (req, res) => {
  await ensureSchema();
  const ip = ipOf(req);
  if (await limited("act", ip, 30, 3600e3)) return send(res, 429, { ok: false, error: "Too many attempts. Try again in an hour." }, CORS);
  const b = await readJSON(req), key = normKey(b.key), installId = clean(b.installId, 64);
  const l = await getLicense(key);
  if (!l || !installId) { await event("activate-failed", key, ip); return send(res, 404, { ok: false, error: "This license key isn't valid. Check it and try again." }, CORS); }
  if (l.revoked) return send(res, 403, { ok: false, error: "This license has been deactivated. Contact Dodail Solutions." }, CORS);
  if (l.activatedAt && l.expiresAt <= Date.now()) return send(res, 403, { ok: false, error: (l.trial ? "Your free trial ended on " : "This license expired on ") + new Date(l.expiresAt).toDateString() + ". Choose a plan to continue.", status: "expired" }, CORS);
  if (l.installId && l.installId !== installId) return send(res, 409, { ok: false, error: "This key is already in use on another computer. Ask Dodail to release it, or use “Release this computer” on the old one." }, CORS);

  const now = Date.now(), first = !l.activatedAt, c = b.customer || {};
  const customer = Object.assign({}, l.customer);
  ["business", "name", "phone", "email", "city", "category"].forEach(f => { if (c[f]) customer[f] = clean(c[f]); });
  // Conditional update: two computers racing for the same unused key can't both win.
  const row = await one(
    `UPDATE licenses SET install_id = $2, customer = $3::jsonb, version = $4, last_seen = $5, ip = $6,
       activated_at = CASE WHEN activated_at = 0 THEN $5 ELSE activated_at END,
       expires_at   = CASE WHEN activated_at = 0 THEN $5 + days::bigint * 86400000 ELSE expires_at END
     WHERE key = $1 AND (install_id = '' OR install_id = $2) RETURNING *`,
    [key, installId, JSON.stringify(customer), clean(b.version, 20), now, ip]);
  if (!row) return send(res, 409, { ok: false, error: "This key was just activated on another computer." }, CORS);
  const lic = fromRow(row);
  await event(first ? "activated" : "re-activated", key, lic.customer.business);
  send(res, 200, Object.assign({ ok: true, license: signedFor(lic, installId) }, await clientExtras()), CORS);
}, { cors: true });
