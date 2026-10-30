// POST /api/release {key, installId} — the customer frees their key to move to a new computer.
import { route, send, readJSON, ipOf, clean, CORS } from "../lib/http.js";
import { q, ensureSchema } from "../lib/db.js";
import { normKey, getLicense, event, limited } from "../lib/license.js";

export default route(["POST"], async (req, res) => {
  await ensureSchema();
  const ip = ipOf(req);
  if (await limited("rel", ip, 20, 3600e3)) return send(res, 429, { ok: false, error: "Too many requests" }, CORS);
  const b = await readJSON(req), key = normKey(b.key), l = await getLicense(key);
  if (!l || !l.installId || l.installId !== clean(b.installId, 64)) return send(res, 404, { ok: false, error: "Not found" }, CORS);
  await q("UPDATE licenses SET install_id = '' WHERE key = $1", [key]);
  await event("released-by-user", key, l.customer.business);
  send(res, 200, { ok: true }, CORS);
}, { cors: true });
