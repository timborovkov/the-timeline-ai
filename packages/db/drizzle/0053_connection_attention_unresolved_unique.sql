WITH ranked_attention AS (
  SELECT
    "id",
    row_number() OVER (
      PARTITION BY
        "team_id",
        "category",
        COALESCE("provider_connection_id", '00000000-0000-0000-0000-000000000000'::uuid),
        COALESCE("integration_id", '00000000-0000-0000-0000-000000000000'::uuid),
        COALESCE("resource_share_id", '00000000-0000-0000-0000-000000000000'::uuid)
      ORDER BY "last_seen_at" DESC, "first_seen_at" DESC, "id" DESC
    ) AS row_number
  FROM "connection_attention"
  WHERE "resolved_at" IS NULL
)
UPDATE "connection_attention"
SET "resolved_at" = now()
FROM ranked_attention
WHERE "connection_attention"."id" = ranked_attention."id"
  AND ranked_attention.row_number > 1;--> statement-breakpoint
CREATE UNIQUE INDEX "connection_attention_unresolved_target_unq"
ON "connection_attention" USING btree (
  "team_id",
  "category",
  COALESCE("provider_connection_id", '00000000-0000-0000-0000-000000000000'::uuid),
  COALESCE("integration_id", '00000000-0000-0000-0000-000000000000'::uuid),
  COALESCE("resource_share_id", '00000000-0000-0000-0000-000000000000'::uuid)
)
WHERE "resolved_at" IS NULL;
