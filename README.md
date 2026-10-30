# Dodail Reach – License server on Vercel + Neon

This is the Vercel version of the Reach license server and admin dashboard. It works exactly like the earlier Node server: same API, same dashboard, same signing key. Every copy of Reach you've already sent keeps working.

| URL | What it is |
|---|---|
| `https://license.dodail.com/admin` | Admin dashboard (log in, generate keys, deactivate, extend, export) |
| `POST /api/activate`, `/api/check`, `/api/release` | Called by the Reach extension |
| `/health` | Uptime check |

## Dashboard features

- **Totals** for all keys, active, online today, expiring in 7 days, expired, deactivated and not yet activated. Click any card to filter the list.
- **Revenue:** this month (India time), the last 30 days and all time. Enter the amount received when you generate or renew a key.
- **Renewals due:** keys ending in the next 7 days, each with a **Remind** button. It opens WhatsApp with a ready renewal message to that customer.
- **Send key on WhatsApp:** after generating a key, or from the license drawer. The message includes the key and the five setup steps.
- **License drawer:**
  - Customer details and usage: CRM contacts, messages sent today, AI mode, version.
  - A full **history** of activations, renewals and payments.
  - Total paid.
  - Actions: renew/extend, deactivate/reactivate, release computer, delete unused key.
- **Renew dialog:** quick 1 / 3 / 6 / 12-month options plus the amount received.
- **Registration details sync:** the business, contact person, phone, email, city and category arrive automatically when the customer finishes Reach's setup.

## Deploy (about 20 minutes, one time)

**What you need**
- A **Vercel Pro** account ($20/month). The free Hobby plan doesn't allow commercial use.
- A GitHub account.

1. **Put this folder in a private GitHub repo.** `.gitignore` already keeps secrets and local data out.
2. **Vercel → Add New → Project →** import the repo. The framework preset is **Other**; leave the build settings empty and deploy.
3. **Add the database:** in the project, open **Storage → Create → Neon (Postgres) → Connect**. This adds `DATABASE_URL` for you. Tables are created automatically on your first admin login.
4. **Create the secrets on your computer** (Node 18+), from inside this folder:
   ```bash
   npm install
   npm run setup -- --keys ../dodail-reach-license-server/data/keys.json
   ```
   Using `--keys` reuses the signing key already built into Reach, so installed copies keep working. The command prints `ADMIN_USER`, `ADMIN_PASSWORD` and `LICENSE_PRIVATE_KEY`.
5. **Vercel → Settings → Environment Variables →** add those three for Production, then **Deployments → Redeploy**.
6. **Domain:** go to Vercel → Settings → Domains and add `license.dodail.com`. At your DNS provider, add the CNAME record Vercel shows (`cname.vercel-dns.com`). HTTPS is automatic.
7. **Check:** open `https://license.dodail.com/health`, which should show `{"ok":true,...}`, then log in at `/admin`.

### Move your existing licenses (if you used the old Node server)
```bash
DATABASE_URL="<copy from Vercel → Storage → Neon → .env.local tab>" \
  node scripts/import-json.js ../dodail-reach-license-server/data/db.json
```
The import is safe to run twice: keys already in the database are skipped. Run it with `--dry-run` first to see the counts.

## Run it locally (no database server needed)

```bash
npm install
npm run setup -- --keys ../dodail-reach-license-server/data/keys.json --write   # creates .env.local with an embedded database
npm run dev                                                                      # http://localhost:3000/admin
```

## Point a Reach build at a different server

```bash
node scripts/configure-extension.js ../dodail-reach-extension https://license.dodail.com
```

## Keep these safe

- **`LICENSE_PRIVATE_KEY`:** anyone who has it can create licenses. It lives only in Vercel's encrypted environment variables and in your offline backup of `keys.json`.
- **Backups:** Neon keeps point-in-time history (7 days on the free plan). For extra safety, download **Export CSV** from the dashboard every week.

## How this differs from the Node server

- Licenses live in Neon Postgres, so they survive every redeploy.
- Rate limits are stored in the database, because serverless functions don't share memory.
- The admin password starts from `ADMIN_PASSWORD`. Once you change it in the dashboard, the new password is stored hashed in the database and wins over the env var.
- Two computers activating the same unused key at the same moment can't both win; the database update is conditional.

## Coming next (Phases B–D of the plan)

1. A 24-hour signed session from each check, plus a file fingerprint so edited copies are refused.
2. AI replies proxied through this server, with usage counted per license.
3. WhatsApp page settings served from this server.
4. A scrambled-build script.
5. Admin views for modified copies and AI usage.
