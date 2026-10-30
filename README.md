# Dodail Reach – License portal (Vercel + Supabase)

The license API that every copy of Reach talks to, plus the admin portal your team uses to sell, renew and track licenses. Licenses, plans, payments and the team live in **Supabase Postgres**; team sign-in uses **Supabase Auth**; the code runs on **Vercel**. The signing key is unchanged, so every copy of Reach already installed keeps working.

| URL | What it is |
|---|---|
| `https://license.dodail.com/admin` | Admin portal: dashboard, licenses, payments, plans, team, settings |
| `https://license.dodail.com/admin/receipt.html?id=…` | Printable receipt (sign-in required) |
| `POST /api/activate`, `/api/check`, `/api/release` | Called by Reach to activate and check a key |
| `POST /api/trial` | Starts a self-serve free trial from Reach's welcome page |
| `GET /api/plans` | Public price list and trial offer shown in Reach |
| `/health` | Uptime check |

## What the portal does

- **Dashboard:** revenue this month and over 30 days, paying customers, trials running and the share that converted, renewals due in 7 days (with a WhatsApp **Remind** button), a 30-day revenue chart and recent activity with who did what.
- **Licenses:** search and filter (paying, trials, ending soon, expired, Starter, AI Pro…). Create keys from a plan, record the payment at the same time and send the key on WhatsApp with setup steps. The drawer shows customer details, usage, terms acceptance, every payment with its receipt, and the full history.
- **Renew or convert:** pick a plan; its days are added after the current end date (or from today if expired). A trial converts to a paid license on the same key. Reach picks up the new plan at its next check, with no reinstall.
- **Payments and receipts:** every payment gets a receipt number in the Indian financial year (`DR/2026-27/0001`). Receipts print on A4 or save as PDF, with your company details, GSTIN and the amount in words. Export as CSV for your accountant.
- **Plans & prices:** Starter and AI Pro, each in 1, 3 and 6 months (₹999 / 2,699 / 4,999 and ₹2,499 / 6,999 / 12,999 to start). Add, edit, re-price or hide plans. Starter doesn't include the AI agent; Reach shows an upgrade prompt instead.
- **Team:** invite people by email. **Owners** manage plans, prices, settings and the team; **staff** create, renew and record payments. Removing someone signs them out at once.
- **Settings:** free trial on/off and length, the update notice (latest version + download link), company details for receipts, the sales WhatsApp number or buy page, and the extension connection.

## What customers see in Reach (v0.9)

- **Free trial** on the welcome page (7 days, every feature, one per computer, number and email), or **activate a key**.
- **Terms of use and Privacy policy** to accept during setup; the time they accepted is stored with the license.
- **Trial and renewal banners**, and when a trial or license ends, a lock card listing your active plans. Tapping a plan opens WhatsApp to your sales number with the plan and key filled in.
- **"New version available"** in the sidebar, popup, settings and About page once you set the update notice.
- **About** page with version, license and company details.

## Set up Supabase (one time, about 15 minutes)

Project: `https://pdobgltfrxdnijdrzkyf.supabase.co`

1. **Database connection.** Supabase → **Connect** → **Transaction pooler** → copy the URI (port **6543**) and put your database password in it. This is `DATABASE_URL`. Use the pooler, not the direct connection: Vercel functions open many short connections.
2. **API keys.** Project Settings → **API Keys**: copy the **anon / publishable** key (`SUPABASE_ANON_KEY`) and the **service_role / secret** key (`SUPABASE_SERVICE_ROLE_KEY`). The secret key stays in Vercel only.
3. **Auth URLs.** Authentication → **URL Configuration**:
   - Site URL: `https://license.dodail.com/admin`
   - Redirect URLs: add `https://license.dodail.com/admin` (and `http://localhost:3000/admin` for local testing).
4. **Turn off public sign-ups.** Authentication → Sign In / Providers → Email: keep email enabled, turn **Allow new users to sign up** off. Only people you invite from the portal (or add in Supabase) can sign in, and the portal also checks its own team list.
5. **Create the first owner.** Authentication → Users → **Add user** → `marketing@dodail.com` with a password (tick *Auto confirm*). Set `ADMIN_OWNER_EMAIL=marketing@dodail.com`; that person becomes the owner on first sign-in. You can also skip the password and use **Forgot password?** on the portal.
6. **Emails (optional but recommended).** Authentication → Emails: edit the *Invite user* and *Reset password* templates to say "Dodail Reach License Portal". For reliable delivery, add your own SMTP (for example your marketing@dodail.com mailbox) under Authentication → SMTP Settings; Supabase's built-in mailer is rate-limited.
7. **Tables** are created automatically the first time the API runs. To create them by hand instead, paste `db/schema.sql` into Supabase → **SQL Editor** → Run. Row Level Security is switched on for every table and the public `anon`/`authenticated` roles get no access, so the data is reachable only through this server.

## Deploy on Vercel

You need a **Vercel Pro** account (the Hobby plan doesn't allow commercial use) and a private GitHub repo with this folder.

1. Vercel → **Add New → Project** → import the repo. Framework preset: **Other**; leave build settings empty.
2. Create the signing key on your computer (Node 18+), in this folder:
   ```bash
   npm install
   npm run setup -- --keys ../dodail-reach-license-server/data/keys.json
   ```
   `--keys` reuses the key already built into Reach, so installed copies keep working. It prints every variable to add.
3. Vercel → Settings → **Environment Variables** (Production): `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_OWNER_EMAIL`, `LICENSE_PRIVATE_KEY`. Then **Deployments → Redeploy**.
4. **Domain:** Settings → Domains → add `license.dodail.com`, and add the CNAME Vercel shows at your DNS provider.
5. **Check:** `https://license.dodail.com/health` shows `{"ok":true,…}`; sign in at `/admin` as marketing@dodail.com.
6. **First steps in the portal:** Settings → check company details, GSTIN and the sales WhatsApp number → Plans & prices → adjust prices → Team → invite your sales staff.

### Moving from Neon or the old Node server
- Old Node server data: `DATABASE_URL="<Supabase pooler URI>" node scripts/import-json.js ../dodail-reach-license-server/data/db.json` (run with `--dry-run` first; safe to run twice).
- From Neon: export the `licenses` and `events` tables as CSV in Neon and import them into the same tables in Supabase → Table Editor, then sign in once so the new columns and plans are added.

## Run it locally (no database server or Supabase needed)

```bash
npm install
npm run setup -- --keys ../dodail-reach-license-server/data/keys.json --write   # .env.local with an embedded database
npm run dev                                                                      # http://localhost:3000/admin
```
Without the `SUPABASE_*` variables the portal uses one shared password (`ADMIN_USER` / `ADMIN_PASSWORD`) and the Team page explains how to switch on team sign-in.

## Point a Reach build at a different server

```bash
node scripts/configure-extension.js ../dodail-reach-extension https://license.dodail.com
```

## Keep these safe

- **`LICENSE_PRIVATE_KEY`:** anyone who has it can create licenses. Keep it only in Vercel and in an offline backup of `keys.json`.
- **`SUPABASE_SERVICE_ROLE_KEY` and the database password:** full access to your data. Vercel only; never in the extension.
- **Backups:** Supabase Pro keeps daily backups. Also download **Export CSV** from Licenses and Payments every month.

## Security notes

- Team sessions are signed, HttpOnly, SameSite=Strict cookies scoped to `/admin`, re-checked against the team list on every request.
- Sign-in, password reset, activation and trials are rate-limited per IP in the database.
- Licenses are ECDSA P-256 signed and bound to one computer; Reach refuses edited or copied licenses and a wound-back clock.
- The portal sends a strict Content-Security-Policy (no inline scripts or styles), `X-Frame-Options`-equivalent `frame-ancestors 'none'`, and `noindex`.
