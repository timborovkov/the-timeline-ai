ALTER TABLE teams ADD COLUMN record_maintenance jsonb NOT NULL DEFAULT
  '{"revision":"0","reviewManualValues":false,"approveRemovals":false,"approveMerges":false}'::jsonb;
