// Database access. Production: Supabase (or any Postgres) via the postgres driver, or Neon over HTTP when the URL is a neon.tech one.
// Local development and tests: DATABASE_URL=pglite:<folder> runs an embedded Postgres (no server needed).
import { SCHEMA } from "./schema.js";

let client = null;

async function connect() {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL || "";
  if (!url) throw new Error("DATABASE_URL is not set. Add your Supabase connection string to this Vercel project.");
  if (url.startsWith("pglite:")) {
    const { PGlite } = await import("@electric-sql/pglite");
    const dir = url.slice(7);
    if (dir) (await import("node:fs")).mkdirSync(dir, { recursive: true });
    const db = new PGlite(dir || undefined);
    await db.exec(SCHEMA);
    return { query: async (text, params) => (await db.query(text, params)).rows, exec: t => db.exec(t) };
  }
  if (/\.neon\.tech[/:]/.test(url)) {
    const { neon } = await import("@neondatabase/serverless");
    const sql = neon(url);
    return { query: (text, params) => sql.query(text, params || []), exec: async t => { for (const s of t.split(/;\s*$/m).map(x => x.trim()).filter(Boolean)) await sql.query(s); } };
  }
  // Supabase: use the pooler connection string (port 6543, transaction mode), which doesn't support prepared statements.
  const postgres = (await import("postgres")).default;
  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
  const sql = postgres(url, { prepare: false, max: 5, ssl: local ? false : "require" });
  return { query: async (text, params) => [...(await sql.unsafe(text, params || []))], exec: t => sql.unsafe(t) };
}

export async function db() {
  if (!client) client = await connect();
  return client;
}
export async function q(text, params = []) { return (await db()).query(text, params); }
export async function one(text, params = []) { return (await q(text, params))[0] || null; }

// Creates tables if missing. Called by `npm run setup` and on first admin login, so a fresh Neon DB just works.
let schemaDone = false;
export async function ensureSchema() {
  if (schemaDone) return;
  const sqlText = SCHEMA.replace(/--.*$/gm, "");
  await (await db()).exec(sqlText);
  schemaDone = true;
}
