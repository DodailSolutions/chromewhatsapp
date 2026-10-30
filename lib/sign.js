// License signing (ECDSA P-256, raw r||s signature, base64url) — identical format to the original server,
// so every Reach build already in the field keeps verifying.
// LICENSE_PRIVATE_KEY: the PKCS#8 PEM from the old server's data/keys.json ("privatePem").
// In the Vercel env editor you can paste it with real line breaks or with "\n" escapes.
import crypto from "node:crypto";

let priv = null;
function privateKey() {
  if (priv) return priv;
  const pem = String(process.env.LICENSE_PRIVATE_KEY || "").replace(/\\n/g, "\n").trim();
  if (!pem.includes("PRIVATE KEY")) throw new Error("LICENSE_PRIVATE_KEY is not set (PEM from data/keys.json).");
  priv = crypto.createPrivateKey(pem);
  return priv;
}
export function publicJwk() {
  const j = crypto.createPublicKey(privateKey()).export({ format: "jwk" });
  return { kty: j.kty, crv: j.crv, x: j.x, y: j.y };
}
const b64u = buf => Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export function sign(payloadObj) {
  const payload = JSON.stringify(payloadObj);
  const sig = crypto.sign("sha256", Buffer.from(payload), { key: privateKey(), dsaEncoding: "ieee-p1363" });
  return { payload, sig: b64u(sig) };
}
