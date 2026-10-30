// Prepares the values to paste into Vercel → Settings → Environment Variables.
//   npm run setup -- --keys ../dodail-reach-license-server/data/keys.json   (reuse the key already built into Reach — recommended)
//   npm run setup                                                          (create a brand-new signing key)
// With --write it also creates .env.local for local testing.
import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const keysArg = args.includes("--keys") ? args[args.indexOf("--keys") + 1] : "";
let pem, source;
if (keysArg) {
  pem = JSON.parse(fs.readFileSync(keysArg, "utf8")).privatePem; source = `reused from ${keysArg}`;
} else {
  pem = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ type: "pkcs8", format: "pem" }); source = "NEW key (rebuild the extension with configure-extension.js)";
}
const pub = crypto.createPublicKey(pem).export({ format: "jwk" });
const password = crypto.randomBytes(12).toString("base64url");
const escaped = pem.trim().replace(/\n/g, "\\n");

console.log(`\nSigning key: ${source}\nPublic key (built into Reach): ${JSON.stringify({ kty: pub.kty, crv: pub.crv, x: pub.x, y: pub.y })}\n`);
console.log("Paste these into Vercel → Project → Settings → Environment Variables (Production):\n");
console.log(`ADMIN_USER=admin`);
console.log(`ADMIN_PASSWORD=${password}      ← or choose your own (10+ characters)`);
console.log(`LICENSE_PRIVATE_KEY=${escaped}`);
console.log(`\nDATABASE_URL is added for you when you connect Neon (Vercel → Storage → Neon → Connect).\n`);

if (args.includes("--write")) {
  const env = `DATABASE_URL=pglite:.data/db\nADMIN_USER=admin\nADMIN_PASSWORD=${password}\nLICENSE_PRIVATE_KEY="${escaped}"\n`;
  fs.writeFileSync(path.join(ROOT, ".env.local"), env, { mode: 0o600 });
  console.log("Wrote .env.local for local testing (embedded database in .data/).");
}
