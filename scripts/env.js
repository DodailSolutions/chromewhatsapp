// Minimal .env loader for the local scripts (Vercel injects env vars itself).
import fs from "node:fs";
import path from "node:path";
export function loadEnv(root) {
  for (const f of [".env.local", ".env"]) {
    const fp = path.join(root, f);
    if (!fs.existsSync(fp)) continue;
    const text = fs.readFileSync(fp, "utf8");
    const re = /^\s*([A-Z0-9_]+)\s*=\s*("(?:[^"\\]|\\.)*"|[^\r\n#]*)/gm;
    let m;
    while ((m = re.exec(text))) {
      let v = m[2].trim();
      if (v.startsWith('"')) v = JSON.parse(v);
      if (process.env[m[1]] === undefined && v !== "") process.env[m[1]] = v;
    }
  }
}
