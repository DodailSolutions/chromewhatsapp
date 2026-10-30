-- Dodail Reach license database (Neon Postgres). Safe to run more than once.
-- Times are milliseconds since 1970 (same as the extension and the old JSON server).

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
CREATE INDEX IF NOT EXISTS licenses_last_seen ON licenses (last_seen DESC);

CREATE TABLE IF NOT EXISTS events (
  id      bigserial PRIMARY KEY,
  t       bigint NOT NULL,
  type    text   NOT NULL,
  key     text   NOT NULL DEFAULT '',
  detail  text   NOT NULL DEFAULT '',
  amount  integer NOT NULL DEFAULT 0      -- money received with this event, in rupees (key sale or renewal)
);
ALTER TABLE events ADD COLUMN IF NOT EXISTS amount integer NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS events_t ON events (t DESC);
CREATE INDEX IF NOT EXISTS events_key ON events (key);

-- Fixed-window rate limits (serverless functions share no memory)
CREATE TABLE IF NOT EXISTS rate_limits (
  k      text PRIMARY KEY,
  n      integer NOT NULL,
  reset  bigint  NOT NULL
);

-- Admin settings that can change at runtime (e.g. password changed from the dashboard)
CREATE TABLE IF NOT EXISTS settings (
  k  text PRIMARY KEY,
  v  jsonb NOT NULL
);

-- Phase B/C: registered extension builds (file fingerprints) and AI usage per license
CREATE TABLE IF NOT EXISTS builds (
  hash        text PRIMARY KEY,
  version     text    NOT NULL,
  created_at  bigint  NOT NULL,
  note        text    NOT NULL DEFAULT '',
  active      boolean NOT NULL DEFAULT true
);
CREATE TABLE IF NOT EXISTS ai_usage (
  key     text    NOT NULL,
  month   text    NOT NULL,
  calls   integer NOT NULL DEFAULT 0,
  tokens  integer NOT NULL DEFAULT 0,
  PRIMARY KEY (key, month)
);

-- Supabase exposes the public schema through its REST API with the public anon key.
-- RLS with no policies blocks that; this server connects as the table owner, so it is unaffected.
ALTER TABLE licenses    ENABLE ROW LEVEL SECURITY;
ALTER TABLE events      ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings    ENABLE ROW LEVEL SECURITY;
ALTER TABLE builds      ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_usage    ENABLE ROW LEVEL SECURITY;
