ALTER TABLE mcp_servers ADD COLUMN next_health_check_at timestamptz;
ALTER TABLE mcp_servers ADD COLUMN health_failures integer NOT NULL DEFAULT 0;
