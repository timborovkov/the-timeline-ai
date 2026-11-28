ALTER TABLE board_import_rules
  DROP CONSTRAINT board_import_rules_provider_check,
  ADD CONSTRAINT board_import_rules_provider_check CHECK (provider IN ('github','linear','hubspot'));
