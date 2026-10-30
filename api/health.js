// GET /health — quick uptime check (also confirms the database and signing key are configured).
import { route, send } from "../lib/http.js";
import { one } from "../lib/db.js";
import { publicJwk } from "../lib/sign.js";

export default route(["GET"], async (req, res) => {
  const r = await one("SELECT count(*)::int AS n FROM licenses");
  publicJwk();
  send(res, 200, { ok: true, licenses: Number(r.n) });
});
