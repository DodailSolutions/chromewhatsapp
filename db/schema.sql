-- Dodail Reach license platform — Supabase (Postgres) schema. Safe to run more than once.
-- Run automatically on the first admin login, or paste into Supabase → SQL Editor → Run.
-- Times are milliseconds since 1970 (same as the extension). Money is whole rupees.

CREATE TABLE IF NOT EXISTS licenses (
  key           text PRIMARY KEY,
  plan          text    NOT NULL DEFAULT 'pro',
  days          integer NOT NULL DEFAULT 30,
  created_at    bigint  NOT NULL,
  activated_at  bigint  NOT NULL DEFAULT 0,
  expires_at    bigint  NOT NULL DEFAULT 0,
  revoked       boolean NOT NULL DEFAULT false,
  install_id    text    NOT NULL DEFAULT '',
  note          text    NOT NULL DEFAULT '',
  customer      jsonb   NOT NULL DEFAULT '{}'::jsonb,
  last_seen     bigint  NOT NULL DEFAULT 0,
  version       text    NOT NULL DEFAULT '',
  ip            text    NOT NULL DEFAULT '',
  stats         jsonb
);
ALTER TABLE licenses ADD COLUMN IF NOT EXISTS plan_id  text    NOT NULL DEFAULT '';
ALTER TABLE licenses ADD COLUMN IF NOT EXISTS tier     text    NOT NULL DEFAULT 'pro';
ALTER TABLE licenses ADD COLUMN IF NOT EXISTS trial    boolean NOT NULL DEFAULT false;
ALTER TABLE licenses ADD COLUMN IF NOT EXISTS terms_at bigint  NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS licenses_last_seen ON licenses (last_seen DESC);

CREATE TABLE IF NOT EXISTS events (
  id      bigserial PRIMARY KEY,
  t       bigint NOT NULL,
  type    text   NOT NULL,
  key     text   NOT NULL DEFAULT '',
  detail  text   NOT NULL DEFAULT '',
  amount  integer NOT NULL DEFAULT 0
);
ALTER TABLE events ADD COLUMN IF NOT EXISTS amount integer NOT NULL DEFAULT 0;
ALTER TABLE events ADD COLUMN IF NOT EXISTS actor  text    NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS events_t ON events (t DESC);
CREATE INDEX IF NOT EXISTS events_key ON events (key);

-- Fixed-window rate limits (serverless functions share no memory)
CREATE TABLE IF NOT EXISTS rate_limits (k text PRIMARY KEY, n integer NOT NULL, reset bigint NOT NULL);

-- Settings changed from the portal: trial, update notice, company details for receipts, legacy password
CREATE TABLE IF NOT EXISTS settings (k text PRIMARY KEY, v jsonb NOT NULL);

-- Team: who may sign in to the portal (accounts themselves live in Supabase Auth)
CREATE TABLE IF NOT EXISTS admins (
  email       text PRIMARY KEY,
  name        text    NOT NULL DEFAULT '',
  role        text    NOT NULL DEFAULT 'staff',     -- owner | staff
  active      boolean NOT NULL DEFAULT true,
  created_at  bigint  NOT NULL DEFAULT 0,
  last_login  bigint  NOT NULL DEFAULT 0
);

-- Price list: what you sell
CREATE TABLE IF NOT EXISTS plans (
  id        text PRIMARY KEY,
  name      text    NOT NULL,
  tier      text    NOT NULL DEFAULT 'pro',          -- starter | pro
  days      integer NOT NULL,
  price     integer NOT NULL DEFAULT 0,
  features  text    NOT NULL DEFAULT '',
  active    boolean NOT NULL DEFAULT true,
  sort      integer NOT NULL DEFAULT 0
);

-- Money received; each row prints as a receipt
CREATE TABLE IF NOT EXISTS payments (
  id          bigserial PRIMARY KEY,
  receipt_no  text    NOT NULL UNIQUE,
  key         text    NOT NULL,
  plan_id     text    NOT NULL DEFAULT '',
  plan_name   text    NOT NULL DEFAULT '',
  days        integer NOT NULL DEFAULT 0,
  amount      integer NOT NULL DEFAULT 0,
  method      text    NOT NULL DEFAULT '',
  reference   text    NOT NULL DEFAULT '',
  note        text    NOT NULL DEFAULT '',
  customer    jsonb   NOT NULL DEFAULT '{}'::jsonb,
  paid_at     bigint  NOT NULL,
  actor       text    NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS payments_paid_at ON payments (paid_at DESC);
CREATE INDEX IF NOT EXISTS payments_key ON payments (key);

-- One free trial per computer, phone number and email
CREATE TABLE IF NOT EXISTS trials (
  install_id  text PRIMARY KEY,
  phone       text NOT NULL DEFAULT '',
  email       text NOT NULL DEFAULT '',
  key         text NOT NULL,
  t           bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS trials_phone ON trials (phone);
CREATE INDEX IF NOT EXISTS trials_email ON trials (email);

CREATE TABLE IF NOT EXISTS builds (hash text PRIMARY KEY, version text NOT NULL, created_at bigint NOT NULL, note text NOT NULL DEFAULT '', active boolean NOT NULL DEFAULT true);
CREATE TABLE IF NOT EXISTS ai_usage (key text NOT NULL, month text NOT NULL, calls integer NOT NULL DEFAULT 0, tokens integer NOT NULL DEFAULT 0, PRIMARY KEY (key, month));

-- Starter price list (only when the table is empty, so plans you delete stay deleted)
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM plans) THEN INSERT INTO plans (id, name, tier, days, price, features, sort) VALUES ('starter-1m', 'Starter · Monthly', 'starter', 30, 999, 'CRM, follow-ups, broadcasts, templates, Excel upload, reply tracking', 10), ('starter-3m', 'Starter · 3 months', 'starter', 90, 2699, 'CRM, follow-ups, broadcasts, templates, Excel upload, reply tracking', 11), ('starter-6m', 'Starter · 6 months', 'starter', 180, 4999, 'CRM, follow-ups, broadcasts, templates, Excel upload, reply tracking', 12), ('pro-1m', 'AI Pro · Monthly', 'pro', 30, 2499, 'Everything in Starter + AI agent, knowledge base, Calendly and Google Meet booking', 20), ('pro-3m', 'AI Pro · 3 months', 'pro', 90, 6999, 'Everything in Starter + AI agent, knowledge base, Calendly and Google Meet booking', 21), ('pro-6m', 'AI Pro · 6 months', 'pro', 180, 12999, 'Everything in Starter + AI agent, knowledge base, Calendly and Google Meet booking', 22); END IF; END $$;

-- Supabase exposes the public schema through its REST API. Row level security with no policies + revoking the
-- API roles means only this server (which connects as the database owner) can read or write these tables.
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['licenses','events','rate_limits','settings','admins','plans','payments','trials','builds','ai_usage'] LOOP EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t); END LOOP; IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated'; EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated'; END IF; END $$;
