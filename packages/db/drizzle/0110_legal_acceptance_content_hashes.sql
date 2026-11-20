ALTER TABLE legal_acceptances
  ADD COLUMN terms_content_hash text,
  ADD COLUMN privacy_content_hash text,
  ADD CONSTRAINT legal_acceptances_content_hashes_chk CHECK (
    (terms_content_hash IS NULL AND privacy_content_hash IS NULL) OR
    (terms_content_hash IS NOT NULL AND privacy_content_hash IS NOT NULL AND
     terms_content_hash ~ '^[a-f0-9]{64}$' AND privacy_content_hash ~ '^[a-f0-9]{64}$')
  );
