// Small helpers shared by the Vercel functions (they receive Node-style req/res).
export const CORS = { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, POST, OPTIONS", "access-control-allow-headers": "content-type" };

export function send(res, code, body, headers = {}) {
  const isObj = typeof body === "object" && body !== null && !Buffer.isBuffer(body);
  res.statusCode = code;
  const h = Object.assign({ "content-type": isObj ? "application/json; charset=utf-8" : "text/plain; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" }, headers);
  for (const [k, v] of Object.entries(h)) res.setHeader(k, v);
  res.end(isObj ? JSON.stringify(body) : body);
}

// Vercel pre-parses JSON into req.body; the local dev server doesn't. Handle both.
export async function readJSON(req) {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === "object" && !Buffer.isBuffer(req.body)) return req.body;
    const s = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : String(req.body);
    try { return s ? JSON.parse(s) : {}; } catch (e) { throw new Error("Invalid JSON"); }
  }
  return new Promise((resolve, reject) => {
    let n = 0, over = false; const chunks = [];
    // Over the limit: stop keeping data but keep reading, so the client still gets a clean 413 instead of a reset.
    req.on("data", c => { n += c.length; if (over) return; if (n > 64 * 1024) { over = true; chunks.length = 0; reject(new Error("Body too large")); } else chunks.push(c); });
    req.on("end", () => { if (over) return; try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {}); } catch (e) { reject(new Error("Invalid JSON")); } });
    req.on("error", reject);
  });
}

export const ipOf = req => String(req.headers["x-real-ip"] || req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket?.remoteAddress || "?";
export const cookies = req => Object.fromEntries((req.headers.cookie || "").split(";").map(c => c.trim().split("=")).filter(p => p[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join("="))]));
export const clean = (v, n = 120) => String(v == null ? "" : v).replace(/[\u0000-\u001f]/g, " ").trim().slice(0, n);

// Wraps a handler: CORS preflight, method check, error → JSON 400/500.
export function route(methods, fn, { cors = false } = {}) {
  return async (req, res) => {
    try {
      if (cors && req.method === "OPTIONS") return send(res, 204, "", CORS);
      if (!methods.includes(req.method)) return send(res, 405, { ok: false, error: "Method not allowed" }, cors ? CORS : {});
      await fn(req, res);
    } catch (e) {
      const internal = !/Invalid JSON|Body too large/.test(e.message || "");
      if (internal) console.error(e);
      send(res, internal ? 500 : /too large/.test(e.message) ? 413 : 400, { ok: false, error: internal ? "Server error. Try again in a minute." : e.message }, cors ? CORS : {});
    }
  };
}
