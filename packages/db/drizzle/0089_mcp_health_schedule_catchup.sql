-- Billing-branch databases may already be beyond the original health migration timestamp.
ALTER TABLE mcp_servers ADD COLUMN IF NOT EXISTS next_health_check_at timestamptz;--> statement-breakpoint
ALTER TABLE mcp_servers ADD COLUMN IF NOT EXISTS health_failures integer NOT NULL DEFAULT 0;
