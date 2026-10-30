// One-time move from the old Node server's data/db.json into Neon (or the local embedded DB).
//   DATABASE_URL=postgres://… node scripts/import-json.js ../dodail-reach-license-server/data/db.json [--dry-run]
// Existing keys in the database are left untouched (safe to run twice).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "./env.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
loadEnv(ROOT);
const file = process.argv[2], dry = process.argv.includes("--dry-run");
if (!file || !fs.existsSync(file)) { console.error("Usage: node scripts/import-json.js <path to db.json> [--dry-run]"); process.exit(1); }
const data = JSON.parse(fs.readFileSync(file, "utf8"));
const licenses = Object.values(data.licenses || {}), events = data.events || [];
console.log(`Found ${licenses.length} licenses and ${events.length} events in ${file}`);
if (dry) { console.log("Dry run: nothing written."); process.exit(0); }

const { q, one, ensureSchema } = await import("../lib/db.js");
await ensureSchema();
let added = 0, skipped = 0;
for (const l of licenses) {
  const r = await one(
    `INSERT INTO licenses (key, plan, days, created_at, activated_at, expires_at, revoked, install_id, note, customer, last_seen, version, ip, stats)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,$14::jsonb) ON CONFLICT (key) DO NOTHING RETURNING key`,
    [l.key, l.plan || "pro", l.days || 30, l.createdAt || Date.now(), l.activatedAt || 0, l.expiresAt || 0, !!l.revoked, l.installId || "", l.note || "",
     JSON.stringify(l.customer || {}), l.lastSeen || 0, l.version || "", l.ip || "", l.stats ? JSON.stringify(l.stats) : null]);
  r ? added++ : skipped++;
}
const have = Number((await one("SELECT count(*)::int AS n FROM events")).n);
if (!have) for (const e of events) await q("INSERT INTO events (t, type, key, detail) VALUES ($1,$2,$3,$4)", [e.t, e.type, e.key || "", String(e.detail || "")]);
const total = Number((await one("SELECT count(*)::int AS n FROM licenses")).n);
console.log(`Imported ${added} licenses (${skipped} already there). Database now has ${total} licenses.${have ? " Events were already present, so they weren't copied again." : ` Copied ${events.length} events.`}`);
process.exit(0);
