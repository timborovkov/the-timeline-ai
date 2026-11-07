CREATE TABLE auth_continuations (
 token_hash text PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 destination text NOT NULL,
 expires_at timestamptz NOT NULL
);
