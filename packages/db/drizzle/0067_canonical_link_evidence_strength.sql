DELETE FROM "artifact_evidence_associations" AS "legacy"
USING "artifact_evidence_associations" AS "canonical"
WHERE "legacy"."team_id" = "canonical"."team_id"
  AND "legacy"."cluster_id" = "canonical"."cluster_id"
  AND "legacy"."evidence_id" = "canonical"."evidence_id"
  AND "legacy"."role" = "canonical"."role"
  AND "legacy"."association_source" = 'model_candidate'
  AND "legacy"."strength" = 'semantic'
  AND "legacy"."metadata" ->> 'source_kind' = 'shared_link'
  AND NULLIF("legacy"."metadata" ->> 'canonical_url', '') IS NOT NULL
  AND (
    (
      NULLIF("legacy"."metadata" ->> 'provider_object_id', '') IS NOT NULL
      AND "canonical"."association_source" = 'structured_anchor'
    )
    OR (
      NULLIF("legacy"."metadata" ->> 'provider_object_id', '') IS NULL
      AND "canonical"."association_source" = 'hard_anchor'
    )
  );
--> statement-breakpoint
UPDATE "artifact_evidence_associations"
SET
  "strength" = CASE
    WHEN NULLIF("metadata" ->> 'provider_object_id', '') IS NOT NULL
      THEN 'structured'::"artifact_evidence_strength"
    ELSE 'hard'::"artifact_evidence_strength"
  END,
  "association_source" = CASE
    WHEN NULLIF("metadata" ->> 'provider_object_id', '') IS NOT NULL
      THEN 'structured_anchor'::"artifact_association_source"
    ELSE 'hard_anchor'::"artifact_association_source"
  END
WHERE "association_source" = 'model_candidate'
  AND "strength" = 'semantic'
  AND "metadata" ->> 'source_kind' = 'shared_link'
  AND NULLIF("metadata" ->> 'canonical_url', '') IS NOT NULL;
