// Database access. Production: Neon Postgres over HTTP (DATABASE_URL from the Vercel ↔ Neon integration).
// Local development and tests: DATABASE_URL=pglite:<folder> runs an embedded Postgres (no server needed).
import { SCHEMA } from "./schema.js";

let client = null;

async function connect() {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL || "";
  if (!url) throw new Error("DATABASE_URL is not set. Connect a Neon database to this Vercel project.");
  if (url.startsWith("pglite:")) {
    const { PGlite } = await import("@electric-sql/pglite");
    const dir = url.slice(7);
    if (dir) (await import("node:fs")).mkdirSync(dir, { recursive: true });
    const db = new PGlite(dir || undefined);
    await db.exec(SCHEMA);
    return { query: async (text, params) => (await db.query(text, params)).rows, exec: t => db.exec(t) };
  }
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(url);
  return { query: (text, params) => sql.query(text, params || []), exec: async t => { for (const s of t.split(/;\s*$/m).map(x => x.trim()).filter(Boolean)) await sql.query(s); } };
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
