// POST /api/check {key, installId, version, stats} — Reach calls this every 6 hours and when WhatsApp Web opens.
import { route, send, readJSON, ipOf, clean, CORS } from "../lib/http.js";
import { q } from "../lib/db.js";
import { normKey, getLicense, signedFor, limited, event } from "../lib/license.js";

export default route(["POST"], async (req, res) => {
  const ip = ipOf(req);
  if (await limited("chk", ip, 240, 3600e3)) return send(res, 429, { ok: false, error: "Too many requests" }, CORS);
  const b = await readJSON(req), key = normKey(b.key), installId = clean(b.installId, 64);
  const l = await getLicense(key);
  if (!l) return send(res, 404, { ok: false, error: "License not found", status: "missing" }, CORS);
  if (!installId) return send(res, 400, { ok: false, error: "Missing install ID" }, CORS);
  // A key must be bound (activated) to this install before checks return a usable license. Without this, a key the
  // admin released could be kept alive on several computers through checks alone.
  if (!l.installId) return send(res, 409, { ok: false, error: "This key was released from this computer. Enter it again to reactivate.", status: "released" }, CORS);
  if (l.installId !== installId) return send(res, 409, { ok: false, error: "This key is now used on another computer.", status: "moved" }, CORS);
  const s = b.stats && typeof b.stats === "object" ? { contacts: +b.stats.contacts || 0, sentToday: +b.stats.sentToday || 0, aiMode: clean(b.stats.aiMode, 10), category: clean(b.stats.category, 30) } : null;
  const version = clean(b.version, 20) || l.version;
  // Business details from the customer's registration (kept fresh if they edit it in Reach). Only filled fields change.
  const cin = b.customer && typeof b.customer === "object" ? b.customer : {}, customer = Object.assign({}, l.customer);
  let changed = false;
  ["business", "name", "phone", "email", "city", "category"].forEach(f => { const v = clean(cin[f], f === "phone" ? 20 : 120); if (v && v !== customer[f]) { customer[f] = v; changed = true; } });
  await q("UPDATE licenses SET last_seen = $2, version = $3, ip = $4, stats = COALESCE($5::jsonb, stats), customer = $6::jsonb WHERE key = $1",
    [key, Date.now(), version, ip, s ? JSON.stringify(s) : null, JSON.stringify(customer)]);
  if (changed && !l.customer.business && customer.business) await event("registered", key, customer.business);
  send(res, 200, { ok: true, license: signedFor(l, installId) }, CORS);
}, { cors: true });
