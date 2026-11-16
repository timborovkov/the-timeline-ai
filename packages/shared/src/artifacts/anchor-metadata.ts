import { artifactClusterAnchors, type Db } from '@timeline/db';
import { and, eq, sql } from 'drizzle-orm';

import type { ArtifactAnchorInput } from '#src/artifacts/index.js';

export async function refreshArtifactAnchorMetadata(
  db: Db,
  teamId: string,
  anchors: ArtifactAnchorInput[],
): Promise<void> {
  for (const anchor of anchors) {
    const patch = anchor.metadataPatch;
    if (!patch) continue;
    await db
      .update(artifactClusterAnchors)
      .set({
        metadata: sql`COALESCE(${artifactClusterAnchors.metadata}, '{}'::jsonb) || ${JSON.stringify(
          patch,
        )}::jsonb`,
      })
      .where(
        and(
          eq(artifactClusterAnchors.teamId, teamId),
          eq(artifactClusterAnchors.anchorType, anchor.type),
          eq(artifactClusterAnchors.anchorValue, anchor.value),
        ),
      );
  }
}
