import { integrationSelections, integrations, type Db } from '@timeline/db';
import { and, eq, inArray } from 'drizzle-orm';

import { rebindDriveSelectionArtifactLink } from '#src/integrations/google-drive-artifacts.js';
import { driveSelectionIsWatchable } from '#src/integrations/google-drive-scope.js';

import type { DriveSelectionObjectLink } from '#src/integrations/google-drive-link-policy.js';

export interface IntegrationSelectionLinkRow {
  selectionKind: string;
  externalId: string;
  linkedObjectId: string | null;
}

export async function loadIntegrationSelectionLinks(db: Db, integrationId: string) {
  return db
    .select({
      selectionKind: integrationSelections.selectionKind,
      externalId: integrationSelections.externalId,
      linkedObjectId: integrationSelections.linkedObjectId,
    })
    .from(integrationSelections)
    .where(eq(integrationSelections.integrationId, integrationId));
}

/** Use the caller's transaction so selection changes and anchor rebinding commit together. */
export async function reconcileDriveSelectionLinkChanges(
  db: Db,
  input: {
    teamId: string;
    integrationId: string;
    previous: IntegrationSelectionLinkRow[];
    remainingSelections?: DriveSelectionObjectLink[];
  },
): Promise<void> {
  const selections =
    input.remainingSelections ??
    (await loadIntegrationSelectionLinks(db, input.integrationId)).map((row) => ({
      kind: row.selectionKind,
      externalId: row.externalId,
      linkedObjectId: row.linkedObjectId,
    }));
  for (const previous of input.previous) {
    if (!driveSelectionIsWatchable(previous.selectionKind)) continue;
    await rebindDriveSelectionArtifactLink(db, {
      teamId: input.teamId,
      integrationId: input.integrationId,
      selectionKind: previous.selectionKind,
      externalId: previous.externalId,
      previousObjectId: previous.linkedObjectId,
      selections,
    });
  }
}

export async function setIntegrationSelectionObjectLink(
  db: Db,
  input: {
    teamId: string;
    integrationId: string;
    selectionId: string;
    objectId: string | null;
    provider: string;
  },
): Promise<void> {
  const [previous] = await db
    .select({
      selectionKind: integrationSelections.selectionKind,
      externalId: integrationSelections.externalId,
      linkedObjectId: integrationSelections.linkedObjectId,
    })
    .from(integrationSelections)
    .where(
      and(
        eq(integrationSelections.id, input.selectionId),
        eq(integrationSelections.integrationId, input.integrationId),
      ),
    )
    .limit(1);
  if (!previous) throw new Error('Selection not found');
  await db
    .update(integrationSelections)
    .set({ linkedObjectId: input.objectId })
    .where(
      and(
        eq(integrationSelections.id, input.selectionId),
        eq(integrationSelections.integrationId, input.integrationId),
      ),
    );
  if (input.provider === 'google_drive') {
    await reconcileDriveSelectionLinkChanges(db, {
      teamId: input.teamId,
      integrationId: input.integrationId,
      previous: [previous],
    });
  }
}

export async function remapIntegrationSelectionObjectLinks(
  db: Db,
  input: { teamId: string; fromObjectIds: string[]; toObjectId: string },
): Promise<void> {
  const previous = await db
    .select({
      id: integrationSelections.id,
      integrationId: integrationSelections.integrationId,
      selectionKind: integrationSelections.selectionKind,
      externalId: integrationSelections.externalId,
      linkedObjectId: integrationSelections.linkedObjectId,
      provider: integrations.provider,
    })
    .from(integrationSelections)
    .innerJoin(integrations, eq(integrations.id, integrationSelections.integrationId))
    .where(
      and(
        eq(integrations.teamId, input.teamId),
        inArray(integrationSelections.linkedObjectId, input.fromObjectIds),
      ),
    );
  if (previous.length === 0) return;
  await db
    .update(integrationSelections)
    .set({ linkedObjectId: input.toObjectId })
    .where(
      inArray(
        integrationSelections.id,
        previous.map((row) => row.id),
      ),
    );
  const byIntegration = new Map<string, IntegrationSelectionLinkRow[]>();
  for (const row of previous) {
    if (row.provider !== 'google_drive') continue;
    const rows = byIntegration.get(row.integrationId) ?? [];
    rows.push(row);
    byIntegration.set(row.integrationId, rows);
  }
  for (const [integrationId, rows] of byIntegration) {
    await reconcileDriveSelectionLinkChanges(db, {
      teamId: input.teamId,
      integrationId,
      previous: rows,
    });
  }
}
