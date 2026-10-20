-- Telegram (D-082): a chat linked to an account receives its tokens, receipts and warnings, and can send STOP and
-- START. A chat is linked only through a one-time code the signed-in app creates, so nobody links someone else's account.
ALTER TABLE users ADD COLUMN telegram_chat_id text UNIQUE;

CREATE TABLE telegram_links (
  code       text PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  used_at    timestamptz
);

-- Who paused a bill: the person in the app, or STOP. START resumes only what STOP paused.
ALTER TABLE lines ADD COLUMN paused_by text CHECK (paused_by IN ('user', 'stop'));
