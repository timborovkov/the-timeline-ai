CREATE TABLE agent_provisioning_grants (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 name text NOT NULL, token_hash text NOT NULL UNIQUE, prefix text NOT NULL,
 allowance integer NOT NULL CHECK (allowance BETWEEN 1 AND 10), used integer NOT NULL DEFAULT 0 CHECK (used >= 0 AND used <= allowance),
 allow_capture boolean NOT NULL DEFAULT false, expires_at timestamptz NOT NULL, revoked_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE agent_provisioning_receipts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), grant_id uuid NOT NULL REFERENCES agent_provisioning_grants(id) ON DELETE CASCADE,
 idempotency_key text NOT NULL, payload_hash text NOT NULL,
 response_ciphertext text, response_iv text, response_tag text, expires_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX agent_provisioning_receipt_unq ON agent_provisioning_receipts(grant_id, idempotency_key);
CREATE TABLE agent_provisioning_audit (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 grant_id uuid REFERENCES agent_provisioning_grants(id) ON DELETE SET NULL,
 action text NOT NULL, metadata jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX agent_provisioning_owner_time_idx ON agent_provisioning_audit(owner_id, created_at);
