// Database access.
// Production: Supabase Postgres through its connection pooler (DATABASE_URL = the "Transaction pooler" URI
// from Supabase → Project Settings → Database → Connection string, port 6543).
// Local development and tests: DATABASE_URL=pglite:<folder> runs an embedded Postgres (no server needed).
import { SCHEMA } from "./schema.js";

let client = null;

async function connect() {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DB_URL || "";
  if (!url) throw new Error("DATABASE_URL is not set. Paste the Supabase transaction pooler connection string into Vercel.");
  if (url.startsWith("pglite:")) {
    const { PGlite } = await import("@electric-sql/pglite");
    const dir = url.slice(7);
    if (dir) (await import("node:fs")).mkdirSync(dir, { recursive: true });
    const db = new PGlite(dir || undefined);
    await db.exec(SCHEMA);
    return { query: async (text, params) => (await db.query(text, params)).rows, exec: t => db.exec(t) };
  }
  const { default: postgres } = await import("postgres");
  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
  // prepare:false is required by Supabase's transaction pooler (PgBouncer); one connection per serverless instance.
  const sql = postgres(url, { prepare: false, max: 1, idle_timeout: 20, connect_timeout: 15, ssl: local ? false : "require", onnotice: () => {} });
  return { query: async (text, params) => [...(await sql.unsafe(text, params || []))], exec: t => sql.unsafe(t) };
}

export async function db() {
  if (!client) client = await connect();
  return client;
}
export async function q(text, params = []) { return (await db()).query(text, params); }
export async function one(text, params = []) { return (await q(text, params))[0] || null; }

// Creates or upgrades tables. Runs on the first admin login and from `npm run setup -- --db`, so a fresh Supabase project just works.
// Bump SCHEMA_VERSION whenever schema.sql changes; each database then upgrades itself once.
export const SCHEMA_VERSION = 3;
let schemaDone = false;
export async function ensureSchema() {
  if (schemaDone) return;
  try {
    const r = await one("SELECT v FROM settings WHERE k = 'schema_version'");
    if (r && Number(typeof r.v === "string" ? JSON.parse(r.v) : r.v) >= SCHEMA_VERSION) { schemaDone = true; return; }
  } catch (e) { /* tables not created yet */ }
  await (await db()).exec(SCHEMA.replace(/^\s*--.*$/gm, ""));
  await q("INSERT INTO settings (k, v) VALUES ('schema_version', $1::jsonb) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v", [JSON.stringify(SCHEMA_VERSION)]);
  schemaDone = true;
}
