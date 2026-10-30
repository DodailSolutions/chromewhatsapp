// Admin login. Password comes from the ADMIN_PASSWORD env var until it's changed in the dashboard;
// after that the scrypt hash in the settings table wins. Sessions are HMAC-signed cookies (no server memory needed).
import crypto from "node:crypto";
import { one, q } from "./db.js";

export const SESSION_HOURS = 12;
export const ADMIN_USER = () => process.env.ADMIN_USER || "admin";
const secret = () => process.env.SESSION_SECRET || crypto.createHash("sha256").update("dr-admin-session|" + (process.env.LICENSE_PRIVATE_KEY || "")).digest("hex");

function hashPw(pw, salt) { salt = salt || crypto.randomBytes(16).toString("hex"); return { salt, hash: crypto.scryptSync(String(pw), salt, 64).toString("hex") }; }
const eq = (a, b) => a.length === b.length && crypto.timingSafeEqual(a, b);

// Returns { tag } where tag changes whenever the password changes (old sessions stop working).
async function current() {
  const row = await one("SELECT v FROM settings WHERE k = 'admin_password'");
  if (row) return { kind: "db", v: row.v, tag: row.v.hash.slice(0, 8) };
  const env = process.env.ADMIN_PASSWORD || "";
  if (env.length < 8) throw new Error("ADMIN_PASSWORD env var is missing or shorter than 8 characters.");
  return { kind: "env", v: env, tag: crypto.createHash("sha256").update(env).digest("hex").slice(0, 8) };
}
export async function checkPassword(pw) {
  const c = await current();
  if (c.kind === "db") return eq(crypto.scryptSync(String(pw || ""), c.v.salt, 64), Buffer.from(c.v.hash, "hex"));
  const a = crypto.createHash("sha256").update(String(pw || "")).digest(), b = crypto.createHash("sha256").update(c.v).digest();
  return eq(a, b);
}
export async function setPassword(pw) {
  await q("INSERT INTO settings (k, v) VALUES ('admin_password', $1::jsonb) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v", [JSON.stringify(hashPw(pw))]);
}
export async function makeSession() {
  const { tag } = await current();
  const body = `${ADMIN_USER()}.${Date.now() + SESSION_HOURS * 3600e3}.${tag}`;
  return body + "." + crypto.createHmac("sha256", secret()).update(body).digest("hex");
}
export async function validSession(tok) {
  if (!tok) return false;
  const i = tok.lastIndexOf("."), body = tok.slice(0, i), mac = tok.slice(i + 1);
  const good = crypto.createHmac("sha256", secret()).update(body).digest("hex");
  if (!eq(Buffer.from(mac), Buffer.from(good))) return false;
  const [, exp, tag] = body.split(".");
  return +exp > Date.now() && tag === (await current()).tag;
}
export function sessionCookie(value, req, maxAge = SESSION_HOURS * 3600) {
  const secure = process.env.VERCEL || req.headers["x-forwarded-proto"] === "https" ? "; Secure" : "";
  return `dr_admin=${encodeURIComponent(value)}; HttpOnly; SameSite=Strict; Path=/admin; Max-Age=${maxAge}${secure}`;
}
