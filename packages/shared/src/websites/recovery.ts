import {
  type Db,
  websiteRuns,
  billingUsageReservations,
  websiteSources,
  teamFirstRun,
} from '@timeline/db';
import { and, eq, sql } from 'drizzle-orm';

import { listChargeCentsForMeter } from '#src/billing/charge.js';
import { BILLING_SYSTEM_USER_ID } from '#src/billing/context.js';
import { getEnv } from '#src/env.js';
import { cancelWebsiteCrawl } from '#src/onboarding/firecrawl-website-scan.js';
import { withTeam } from '#src/team-scope.js';
import { websiteSourceUnits } from '#src/websites/usage.js';

/** Settle only already-persisted, validated outcomes, even after actor revocation.
 * This trusted worker boundary cannot reserve funds or submit provider work. */
export async function settleCapturedWebsiteRun(
  db: Db,
  teamId: string,
  runId: string,
): Promise<void> {
  const [saved] = await db
    .select({ run: websiteRuns, snapshot: websiteSources })
    .from(websiteRuns)
    .innerJoin(
      websiteSources,
      and(eq(websiteSources.teamId, teamId), eq(websiteSources.id, websiteRuns.id)),
    )
    .where(and(eq(websiteRuns.teamId, teamId), eq(websiteRuns.id, runId)));
  if (!saved?.snapshot.pages || (saved.run.billingPolicy === 'legacy' && saved.run.finishedAt))
    return;
  const sourceUnits = websiteSourceUnits(saved.snapshot.pages.length, saved.run.unitsPerPage);
  const billing = withTeam(db, teamId, BILLING_SYSTEM_USER_ID, {
    skipMembershipCheck: true,
  }).billing;
  await billing.settle({
    operationId: `website-scan:${runId}`,
    meterId: 'accepted_sources',
    nativeUnits: sourceUnits,
    customerChargeCents: listChargeCentsForMeter('accepted_sources', sourceUnits),
    operationClass: 'ingest',
    source: 'website_scan',
    ...(saved.run.estimatedProviderCostEur === null
      ? {}
      : { providerCostCents: Math.round(saved.run.estimatedProviderCostEur * 100) }),
  });
  await db
    .update(websiteRuns)
    .set({ sourceUnits, pageCount: saved.snapshot.pages.length })
    .where(and(eq(websiteRuns.teamId, teamId), eq(websiteRuns.id, runId)));
}

/** Trusted worker cleanup: may release work after its original actor loses access, never create new work. */
export async function failWebsiteRun(
  db: Db,
  teamId: string,
  runId: string,
  reason: string,
): Promise<void> {
  await settleCapturedWebsiteRun(db, teamId, runId);
  const [checkpoint] = await db
    .select({ crawlId: websiteSources.crawlId })
    .from(websiteSources)
    .where(and(eq(websiteSources.teamId, teamId), eq(websiteSources.id, runId)));
  let providerFinishedAt: Date | undefined;
  if (checkpoint?.crawlId && getEnv().FIRECRAWL_API_KEY) {
    try {
      await cancelWebsiteCrawl(checkpoint.crawlId, getEnv().FIRECRAWL_API_KEY ?? '');
      providerFinishedAt = new Date();
    } catch {
      /* Retain provider occupancy until cancellation is confirmed. */
    }
  }
  await db.transaction(async (tx) => {
    const [run] = await tx
      .select({ trigger: websiteRuns.trigger })
      .from(websiteRuns)
      .where(and(eq(websiteRuns.teamId, teamId), eq(websiteRuns.id, runId)));
    await tx
      .update(websiteRuns)
      .set({
        ...(providerFinishedAt ? { providerFinishedAt } : {}),
        status: sql`CASE WHEN ${websiteRuns.pageCount} > 0 THEN 'partial' ELSE 'failed' END`,
        failureReason: reason,
        finishedAt: new Date(),
        leaseUntil: null,
      })
      .where(
        and(
          eq(websiteRuns.teamId, teamId),
          eq(websiteRuns.id, runId),
          sql`${websiteRuns.finishedAt} IS NULL`,
        ),
      );
    if (providerFinishedAt)
      await tx
        .update(websiteRuns)
        .set({ providerFinishedAt })
        .where(and(eq(websiteRuns.teamId, teamId), eq(websiteRuns.id, runId)));
    await tx
      .update(billingUsageReservations)
      .set({ state: 'released', updatedAt: new Date() })
      .where(
        and(
          eq(billingUsageReservations.teamId, teamId),
          eq(billingUsageReservations.operationId, `website-scan:${runId}`),
          eq(billingUsageReservations.state, 'reserved'),
        ),
      );
    // Trusted terminal cleanup only: revoked actors cannot repair first-run state through
    // ordinary membership checks. The scan identity and phase guard protect newer choices.
    if (run?.trigger === 'onboarding')
      await tx
        .update(teamFirstRun)
        .set({ phase: 'failed', scanFailureReason: 'unreachable', updatedAt: new Date() })
        .where(
          and(
            eq(teamFirstRun.teamId, teamId),
            eq(teamFirstRun.websiteScanId, runId),
            eq(teamFirstRun.starterPath, 'website'),
            eq(teamFirstRun.phase, 'processing'),
          ),
        );
  });
}
