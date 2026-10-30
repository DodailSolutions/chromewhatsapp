// GET /api/plans — the public price list and trial offer, shown in Reach on the welcome page and when a trial or license ends.
import { ensureSchema } from "../lib/db.js";
import { route, send, CORS } from "../lib/http.js";
import { listPlans, getSetting } from "../lib/store.js";
export default route(["GET"], async (req, res) => {
  await ensureSchema();
  const [plans, sales, trial] = await Promise.all([listPlans(true), getSetting("sales"), getSetting("trial")]);
  send(res, 200, { ok: true, plans: plans.map(p => ({ id: p.id, name: p.name, tier: p.tier, days: p.days, price: p.price, features: p.features })), sales, trial: { enabled: !!trial.enabled, days: trial.days, tier: trial.tier } }, Object.assign({ "cache-control": "public, max-age=300" }, CORS));
}, { cors: true });
