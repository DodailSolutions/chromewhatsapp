// Local stand-in for Vercel: serves public/, applies the vercel.json rewrites and runs api/*.js.
// Usage: npm run dev   (reads .env.local; PORT defaults to 3000)
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadEnv } from "./env.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
loadEnv(ROOT);
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, "vercel.json"), "utf8"));
const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml" };
const handlers = {};

function rewrite(pathname, search) {
  for (const r of cfg.rewrites) {
    const rx = new RegExp("^" + r.source.replace(/:path\*/g, "(.*)") + "$");
    const m = pathname.match(rx);
    if (m) { const dest = r.destination.replace(":path*", m[1] || ""); return dest + (search ? (dest.includes("?") ? "&" : "?") + search.slice(1) : ""); }
  }
  return pathname + search;
}
function headersFor(pathname) {
  const out = {};
  for (const h of cfg.headers) if (new RegExp("^" + h.source.replace("(.*)", ".*") + "$").test(pathname)) h.headers.forEach(x => (out[x.key] = x.value));
  return out;
}

http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  const target = new URL(rewrite(u.pathname, u.search), "http://x");
  for (const [k, v] of Object.entries(headersFor(u.pathname))) res.setHeader(k, v);
  if (target.pathname.startsWith("/api/")) {
    const name = target.pathname.slice(5).replace(/[^a-z0-9_-]/gi, "");
    const file = path.join(ROOT, "api", name + ".js");
    if (!fs.existsSync(file)) { res.statusCode = 404; return res.end("Not found"); }
    handlers[name] = handlers[name] || (await import(pathToFileURL(file))).default;
    req.url = target.pathname + target.search;
    return handlers[name](req, res);
  }
  const fp = path.join(ROOT, "public", decodeURIComponent(target.pathname));
  if (!fp.startsWith(path.join(ROOT, "public")) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { res.statusCode = 404; return res.end("Not found"); }
  res.setHeader("content-type", MIME[path.extname(fp)] || "application/octet-stream");
  fs.createReadStream(fp).pipe(res);
}).listen(+process.env.PORT || 3000, () => console.log(`Dev server on http://localhost:${+process.env.PORT || 3000}  (admin: /admin)`));
