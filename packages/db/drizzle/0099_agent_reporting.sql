ALTER TABLE teams ADD COLUMN agent_reporting jsonb NOT NULL DEFAULT '{"mode":"on_request","scope":"","revision":"0"}';
ALTER TABLE mcp_outbound_keys ADD COLUMN agent_reporting jsonb;
ALTER TABLE mcp_outbound_oauth_grants ADD COLUMN agent_reporting jsonb;
