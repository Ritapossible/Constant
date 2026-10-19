-- Sign-in sessions (D-080). The identity provider's session id (`sid` in the access token) is recorded the first
-- time the API sees it. A session unused for SESSION_IDLE_DAYS, or older than SESSION_MAX_DAYS, is revoked: its
-- tokens are refused even if the provider would still refresh them, and the person signs in again.
CREATE TABLE sessions (
  sid            text PRIMARY KEY,
  user_id        uuid NOT NULL REFERENCES users(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  last_seen_at   timestamptz NOT NULL DEFAULT now(),
  user_agent     text,
  revoked_at     timestamptz,
  revoked_reason text CHECK (revoked_reason IN ('idle', 'max_age', 'signed_out', 'all_signed_out', 'ops'))
);
CREATE INDEX sessions_by_user ON sessions (user_id) WHERE revoked_at IS NULL;
