# Dodail Reach – License portal

Vercel serverless API (`api/*.js`, ESM) + static admin portal (`public/admin`) on Supabase Postgres and Supabase Auth.

## Rules
- Never commit secrets: `.env.local`, `keys.json`, `*.pem` and `.data/` are git-ignored. `LICENSE_PRIVATE_KEY`, `SUPABASE_SERVICE_ROLE_KEY` and the database password go only into Vercel environment variables.
- Do not print secret values in chat or logs. Let the user type them into `vercel env add` prompts.
- The GitHub repo must be **private**.
- No inline `<script>` or `style=""` in `public/` (strict CSP in `vercel.json`).

## Deploy
- Repo: private GitHub repo `dodail-reach-license`, branch `main`.
- Vercel project: framework preset "Other", no build command, output dir left empty. Domain `license.dodail.com`.
- Required env vars (Production): DATABASE_URL (Supabase transaction pooler, port 6543), SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, ADMIN_OWNER_EMAIL, LICENSE_PRIVATE_KEY. Optional: GRACE_DAYS, SESSION_SECRET.
- After deploy: `GET /health` returns `{"ok":true}`; sign in at `/admin`.

## Local
`npm install`, `npm run setup -- --keys <keys.json> --write`, `npm run dev` → http://localhost:3000/admin (embedded DB, single-password mode).
