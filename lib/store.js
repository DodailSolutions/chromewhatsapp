// Settings, plans and payments.
import { q, one } from "./db.js";
import { json } from "./license.js";

// ---------- settings ----------
export const DEFAULTS = {
  trial: { enabled: true, days: 7, tier: "pro" },
  update: { version: "", url: "", notes: "" },
  company: { name: "Dodail Solutions Pvt. Ltd.", address: "Hirkani Tower, Maruthi Nagar, Hyderabad, Telangana, India", gstin: "", email: "marketing@dodail.com", phone: "+91 99664 00235", website: "https://dodail.com", footer: "Thank you for choosing Dodail Reach." },
  sales: { whatsapp: "919966400235", buyUrl: "" }
};
export async function getSetting(k) {
  const r = await one("SELECT v FROM settings WHERE k = $1", [k]);
  return Object.assign({}, DEFAULTS[k] || {}, json(r && r.v, {}));
}
export async function setSetting(k, v) {
  await q("INSERT INTO settings (k, v) VALUES ($1, $2::jsonb) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v", [k, JSON.stringify(v)]);
}

// ---------- plans ----------
const planRow = r => ({ id: r.id, name: r.name, tier: r.tier, days: Number(r.days), price: Number(r.price), features: r.features, active: !!r.active, sort: Number(r.sort) });
export async function listPlans(activeOnly = false) {
  return (await q(`SELECT * FROM plans ${activeOnly ? "WHERE active" : ""} ORDER BY sort, days`)).map(planRow);
}
export async function getPlan(id) { const r = id ? await one("SELECT * FROM plans WHERE id = $1", [id]) : null; return r ? planRow(r) : null; }

// ---------- payments ----------
const payRow = r => ({ id: Number(r.id), receiptNo: r.receipt_no, key: r.key, planId: r.plan_id, planName: r.plan_name, days: Number(r.days), amount: Number(r.amount), method: r.method, reference: r.reference, note: r.note, customer: json(r.customer, {}), paidAt: Number(r.paid_at), actor: r.actor });
// Receipt numbers run per Indian financial year: DR/2026-27/0001.
function fyLabel(t) { const d = new Date(t + 330 * 60000), y = d.getUTCFullYear(), m = d.getUTCMonth(); const s = m >= 3 ? y : y - 1; return `${s}-${String(s + 1).slice(2)}`; }
export async function addPayment({ key, plan, days, amount, method, reference, note, customer, actor }) {
  const amt = Math.max(0, Math.min(10000000, Math.round(+amount || 0)));
  if (!amt) return null;
  const now = Date.now(), fy = fyLabel(now), prefix = `DR/${fy}/`;
  for (let attempt = 0; attempt < 5; attempt++) {
    const last = await one("SELECT receipt_no FROM payments WHERE receipt_no LIKE $1 ORDER BY receipt_no DESC LIMIT 1", [prefix + "%"]);
    const n = last ? parseInt(last.receipt_no.slice(prefix.length), 10) + 1 : 1;
    const r = await one(`INSERT INTO payments (receipt_no, key, plan_id, plan_name, days, amount, method, reference, note, customer, paid_at, actor)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12) ON CONFLICT (receipt_no) DO NOTHING RETURNING *`,
      [prefix + String(n).padStart(4, "0"), key, plan ? plan.id : "", plan ? plan.name : "", days || 0, amt, String(method || "").slice(0, 30), String(reference || "").slice(0, 80), String(note || "").slice(0, 200), JSON.stringify(customer || {}), now, actor || ""]);
    if (r) return payRow(r);
  }
  throw new Error("Couldn't create a receipt number. Try again.");
}
export async function listPayments({ key, limit = 500 } = {}) {
  return (await q(`SELECT * FROM payments ${key ? "WHERE key = $1" : ""} ORDER BY paid_at DESC, id DESC LIMIT ${Math.min(2000, limit | 0)}`, key ? [key] : [])).map(payRow);
}
export async function getPayment(id) { const r = await one("SELECT * FROM payments WHERE id = $1", [id]); return r ? payRow(r) : null; }

// Shown to the extension with every license reply: update notice + how to buy.
export async function clientExtras() {
  const [u, s, t] = await Promise.all([getSetting("update"), getSetting("sales"), getSetting("trial")]);
  return { update: u.version ? { version: u.version, url: u.url, notes: u.notes } : null, sales: { whatsapp: s.whatsapp, buyUrl: s.buyUrl }, trial: { enabled: !!t.enabled, days: t.days } };
}
