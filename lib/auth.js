// Portal sign-in.
// With SUPABASE_URL + SUPABASE_ANON_KEY set: team members sign in with their Supabase Auth email + password, and must
// also be listed (active) in the admins table. Owners invite staff from the portal; Supabase sends the emails.
// Without them (local testing): a single "admin" login from ADMIN_PASSWORD.
// Sessions are HMAC-signed cookies; every request re-checks the admins table, so removing someone signs them out.
import crypto from "node:crypto";
import { one, q } from "./db.js";

export const SESSION_HOURS = 12;
export const supa = () => !!(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY);
const SB = () => String(process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const secret = () => process.env.SESSION_SECRET || crypto.createHash("sha256").update("dr-admin-session|" + (process.env.LICENSE_PRIVATE_KEY || "")).digest("hex");
const eq = (a, b) => a.length === b.length && crypto.timingSafeEqual(a, b);
const b64 = s => Buffer.from(s).toString("base64url"), unb64 = s => Buffer.from(s, "base64url").toString();
const ownerEmail = () => String(process.env.ADMIN_OWNER_EMAIL || "").trim().toLowerCase();

// ---------- Supabase Auth (GoTrue REST) ----------
async function gotrue(path, { method = "POST", body, token, service = false } = {}) {
  const key = service ? process.env.SUPABASE_SERVICE_ROLE_KEY : process.env.SUPABASE_ANON_KEY;
  if (!key) throw new Error(service ? "SUPABASE_SERVICE_ROLE_KEY is not set in Vercel." : "SUPABASE_ANON_KEY is not set.");
  let r;
  try {
    r = await fetch(SB() + "/auth/v1" + path, { method, headers: Object.assign({ apikey: key, "content-type": "application/json" }, token || service ? { authorization: "Bearer " + (token || key) } : {}), body: body ? JSON.stringify(body) : undefined });
  } catch (e) { throw new Error("Couldn't reach Supabase. Check SUPABASE_URL."); }
  let j = {}; try { j = await r.json(); } catch (e) { /* empty */ }
  return { ok: r.ok, status: r.status, data: j };
}
const authError = d => d.error_description || d.msg || d.message || d.error || "Sign-in failed";

// ---------- team table ----------
const adminRow = r => r && { email: r.email, name: r.name, role: r.role, active: !!r.active, createdAt: Number(r.created_at), lastLogin: Number(r.last_login) };
export async function getAdmin(email) { return adminRow(await one("SELECT * FROM admins WHERE email = $1", [String(email || "").toLowerCase()])); }
export async function listAdmins() { return (await q("SELECT * FROM admins ORDER BY role DESC, created_at")).map(adminRow); }
async function bootstrapOwner(email) {
  // First sign-in ever: the ADMIN_OWNER_EMAIL account becomes the owner.
  const any = await one("SELECT 1 AS x FROM admins LIMIT 1");
  if (!any && ownerEmail() && email === ownerEmail()) {
    await q("INSERT INTO admins (email, name, role, active, created_at) VALUES ($1, '', 'owner', true, $2) ON CONFLICT (email) DO NOTHING", [email, Date.now()]);
  }
}

// Returns { email, role, name } or throws with a message for the person.
export async function signIn(user, password) {
  if (!supa()) {
    if (String(user || "") !== (process.env.ADMIN_USER || "admin") || !(await checkLegacyPassword(password))) throw new Error("Wrong username or password.");
    return { email: process.env.ADMIN_USER || "admin", role: "owner", name: "Admin" };
  }
  const email = String(user || "").trim().toLowerCase();
  const r = await gotrue("/token?grant_type=password", { body: { email, password: String(password || "") } });
  if (!r.ok) throw new Error(r.status === 400 ? "Wrong email or password." : authError(r.data));
  return finishSupabase(email);
}
async function finishSupabase(email) {
  await bootstrapOwner(email);
  const a = await getAdmin(email);
  if (!a || !a.active) throw new Error("This account isn't on the Dodail Reach team. Ask the owner to invite you.");
  await q("UPDATE admins SET last_login = $2 WHERE email = $1", [email, Date.now()]);
  return { email, role: a.role, name: a.name };
}
export async function forgotPassword(email, redirect) {
  if (!supa()) throw new Error("Password reset by email needs Supabase to be connected.");
  await gotrue("/recover?redirect_to=" + encodeURIComponent(redirect), { body: { email: String(email || "").trim().toLowerCase() } });
  return true;                                                   // same answer whether or not the email exists
}
// From the link in a reset or invite email: set the password, then sign in.
export async function setPasswordWithToken(accessToken, password) {
  if (String(password || "").length < 10) throw new Error("Use at least 10 characters.");
  const r = await gotrue("/user", { method: "PUT", token: String(accessToken || ""), body: { password: String(password) } });
  if (!r.ok) throw new Error(r.status === 401 || r.status === 403 ? "This link has expired. Ask for a new one." : authError(r.data));
  return finishSupabase(String(r.data.email || "").toLowerCase());
}
export async function invite(email, name, role, redirect) {
  email = String(email || "").trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error("Enter a valid email address.");
  role = role === "owner" ? "owner" : "staff";
  let note = "Invitation email sent.";
  if (supa()) {
    const r = await gotrue("/invite?redirect_to=" + encodeURIComponent(redirect), { service: true, body: { email, data: { name } } });
    if (!r.ok) {
      if (r.status === 422 || /already/i.test(authError(r.data))) note = "They already have an account: they can sign in, or use “Forgot password”.";
      else throw new Error(authError(r.data));
    }
  }
  await q(`INSERT INTO admins (email, name, role, active, created_at) VALUES ($1, $2, $3, true, $4)
    ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, role = EXCLUDED.role, active = true`, [email, String(name || "").slice(0, 80), role, Date.now()]);
  return note;
}
export async function updateAdmin(email, ch) {
  const a = await getAdmin(email); if (!a) throw new Error("Team member not found.");
  if ((ch.active === false || ch.role === "staff") && a.role === "owner") {
    const owners = await one("SELECT count(*)::int AS n FROM admins WHERE role = 'owner' AND active");
    if (Number(owners.n) <= 1) throw new Error("Keep at least one active owner.");
  }
  await q("UPDATE admins SET role = COALESCE($2, role), active = COALESCE($3, active), name = COALESCE($4, name) WHERE email = $1",
    [a.email, ch.role ? (ch.role === "owner" ? "owner" : "staff") : null, typeof ch.active === "boolean" ? ch.active : null, ch.name != null ? String(ch.name).slice(0, 80) : null]);
}

// ---------- legacy single password (local testing / before Supabase is connected) ----------
function hashPw(pw, salt) { salt = salt || crypto.randomBytes(16).toString("hex"); return { salt, hash: crypto.scryptSync(String(pw), salt, 64).toString("hex") }; }
async function legacy() {
  const row = await one("SELECT v FROM settings WHERE k = 'admin_password'");
  const v = row && (typeof row.v === "string" ? JSON.parse(row.v) : row.v);
  if (v) return { kind: "db", v, tag: v.hash.slice(0, 8) };
  const env = process.env.ADMIN_PASSWORD || "";
  if (env.length < 8) throw new Error("ADMIN_PASSWORD env var is missing or shorter than 8 characters.");
  return { kind: "env", v: env, tag: crypto.createHash("sha256").update(env).digest("hex").slice(0, 8) };
}
export async function checkLegacyPassword(pw) {
  const c = await legacy();
  if (c.kind === "db") return eq(crypto.scryptSync(String(pw || ""), c.v.salt, 64), Buffer.from(c.v.hash, "hex"));
  return eq(crypto.createHash("sha256").update(String(pw || "")).digest(), crypto.createHash("sha256").update(c.v).digest());
}
export async function setLegacyPassword(pw) {
  await q("INSERT INTO settings (k, v) VALUES ('admin_password', $1::jsonb) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v", [JSON.stringify(hashPw(pw))]);
}

// ---------- sessions ----------
async function tagFor(email) { return supa() ? "sb" : (await legacy()).tag; }
export async function makeSession(who) {
  const body = `${b64(who.email)}.${Date.now() + SESSION_HOURS * 3600e3}.${await tagFor(who.email)}`;
  return body + "." + crypto.createHmac("sha256", secret()).update(body).digest("hex");
}
// Returns { email, role, name } or null.
export async function sessionUser(tok) {
  if (!tok) return null;
  const i = tok.lastIndexOf("."), body = tok.slice(0, i), mac = tok.slice(i + 1);
  const good = crypto.createHmac("sha256", secret()).update(body).digest("hex");
  if (!mac || !eq(Buffer.from(mac), Buffer.from(good))) return null;
  const [e, exp, tag] = body.split(".");
  if (!(+exp > Date.now()) || tag !== await tagFor()) return null;
  const email = unb64(e);
  if (!supa()) return { email, role: "owner", name: "Admin" };
  const a = await getAdmin(email);
  return a && a.active ? { email, role: a.role, name: a.name } : null;
}
export function sessionCookie(value, req, maxAge = SESSION_HOURS * 3600) {
  const secure = process.env.VERCEL || req.headers["x-forwarded-proto"] === "https" ? "; Secure" : "";
  return `dr_admin=${encodeURIComponent(value)}; HttpOnly; SameSite=Strict; Path=/admin; Max-Age=${maxAge}${secure}`;
}
