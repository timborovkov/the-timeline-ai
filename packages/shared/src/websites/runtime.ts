import { createHash } from 'node:crypto';

import { listChargeCentsForMeter } from '#src/billing/charge.js';
import { getEnv } from '#src/env.js';
import { childLogger } from '#src/logger.js';
import { cancelWebsiteCrawl } from '#src/onboarding/firecrawl-website-scan.js';
import {
  renderWebsitePageContent,
  scanPublicWebsite,
  type WebsiteScanResult,
} from '#src/onboarding/website-scan.js';
import {
  enqueueWebsiteScanJob,
  enqueueDocChunkEmbedJob,
  enqueueExtractJob,
} from '#src/queue/queues.js';
import { withTeam, type TeamScope } from '#src/team-scope.js';
import { authorizeWebsitePrincipal } from '#src/websites/authorization.js';
import { WEBSITE_PAGE_LIMIT, websiteSourceUnits } from '#src/websites/policy.js';
import { settleCapturedWebsiteRun } from '#src/websites/recovery.js';

import type { DeferredChatDelivery } from '#src/conversation-surfaces/deferred-delivery.js';
import type { FirstRunScanFailureReason } from '#src/onboarding/first-run.js';
import type { Db } from '@timeline/db';

export function websiteContentHash(text: string): string {
  return createHash('sha256').update(text.replace(/\r\n/g, '\n').trim()).digest('hex');
}

async function failOnboardingScan(
  scope: TeamScope,
  run: { id: string; trigger: string },
  reason: string | null,
): Promise<void> {
  if (run.trigger !== 'onboarding' || !(await scope.onboarding.getFirstRun())) return;
  const failure: FirstRunScanFailureReason =
    reason === 'robots' ||
    reason === 'no_readable_text' ||
    reason === 'billing_limited' ||
    reason === 'not_enabled' ||
    reason === 'rate_limited'
      ? reason
      : 'unreachable';
  await scope.onboarding.markScanFailed(failure, run.id);
}

export async function startWebsiteScan(
  scope: TeamScope,
  input: {
    websiteId: string;
    idempotencyKey: string;
    permissionConfirmed: boolean;
    trigger?: 'manual' | 'scheduled' | 'onboarding' | 'bot' | 'mcp';
    scanId?: string;
    notification?: DeferredChatDelivery;
  },
) {
  if (!input.permissionConfirmed) throw new Error('Confirm permission to submit this website');
  if (!getEnv().FIRECRAWL_API_KEY?.trim()) throw new Error('Website scanning is not configured');
  if (getEnv().WEBSITE_CRAWLS_DISABLED) throw new Error('Website scanning is temporarily disabled');
  const run = await scope.websites.admit({ ...input, trigger: input.trigger ?? 'manual' });
  if (input.notification) await scope.websites.attachNotification(run.id, input.notification);
  if (run.status !== 'queued') {
    if (run.finishedAt && run.status !== 'completed')
      await failOnboardingScan(scope, run, run.failureReason);
    return run;
  }
  const units = websiteSourceUnits(WEBSITE_PAGE_LIMIT, run.unitsPerPage);
  const admission = await scope.billing.reserve({
    operationId: `website-scan:${run.id}`,
    meterId: 'accepted_sources',
    reservedNativeUnits: units,
    reservedChargeCents: listChargeCentsForMeter('accepted_sources', units),
    ttlMs: 30 * 60_000,
    metadata: { source: 'worker', website_crawl: true },
  });
  if (!admission.ok) {
    await scope.websites.block(run.id, 'billing_limited');
    await failOnboardingScan(scope, run, 'billing_limited');
    return scope.websites.getRun(run.id);
  }
  // The durable queued row is also an outbox: scheduler recovery retries failed enqueue.
  await enqueueWebsiteScanJob({
    teamId: scope.teamId,
    userId: run.requestedBy,
    scanId: run.id,
    ...(run.platformOperatorSessionId
      ? { platformOperatorSessionId: run.platformOperatorSessionId }
      : {}),
  });
  return run;
}

/** Legacy jobs continue through the old adapter; new runs never depend on first-run state. */
export async function processPersistentWebsiteScan(
  db: Db,
  teamId: string,
  userId: string,
  scanId: string,
): Promise<boolean> {
  let scope = withTeam(db, teamId, userId, {
    skipMembershipCheck: userId === '00000000-0000-0000-0000-000000000000',
  });
  let run;
  try {
    run = await scope.websites.getRun(scanId);
  } catch (error) {
    if (error instanceof Error && error.message === 'Website scan not found') return false;
    throw error;
  }
  if (run.principal) {
    await authorizeWebsitePrincipal(db, run.principal, 'websites:scan');
    scope = withTeam(db, teamId, userId, {
      skipMembershipCheck: run.principal.authType === 'api_key',
      websitePrincipal: run.principal,
    });
  }
  if (run.finishedAt) {
    if (run.status !== 'completed') await failOnboardingScan(scope, run, run.failureReason);
    return true;
  }
  if (run.billingPolicy === 'legacy') return false;
  const source = await scope.websites.get(run.websiteId);
  const operationId = `website-scan:${run.id}`;
  if (source.archivedAt || source.paused || getEnv().WEBSITE_CRAWLS_DISABLED) {
    await settleCapturedWebsiteRun(db, teamId, scanId);
    await scope.billing.release(operationId);
    await scope.websites.updateRun(run.id, { status: 'cancelled', finishedAt: new Date() });
    await failOnboardingScan(
      scope,
      run,
      getEnv().WEBSITE_CRAWLS_DISABLED ? 'not_enabled' : 'unreachable',
    );
    return true;
  }
  if (run.trigger === 'scheduled') {
    if (run.principal) await authorizeWebsitePrincipal(db, run.principal, 'websites:manage');
    else await scope.requireMembership('admin');
  }
  let failureReason = run.failureReason;
  let pages = await scope.onboarding.getWebsiteScanPages(scanId);
  if (!pages) {
    const units = websiteSourceUnits(WEBSITE_PAGE_LIMIT, run.unitsPerPage);
    const admission = await scope.billing.reserve({
      operationId,
      meterId: 'accepted_sources',
      reservedNativeUnits: units,
      reservedChargeCents: listChargeCentsForMeter('accepted_sources', units),
      ttlMs: 30 * 60_000,
      metadata: { source: 'worker', website_crawl: true },
    });
    if (!admission.ok) {
      await scope.websites.block(run.id, 'billing_limited');
      await failOnboardingScan(scope, run, 'billing_limited');
      return true;
    }
  }
  if (!pages) {
    const crawlId = await scope.onboarding.getWebsiteCrawlId(scanId);
    // Once a POST may have been accepted, never start a second crawl without its checkpoint.
    if (run.providerStartedAt && !crawlId) {
      childLogger('websites').error(
        { teamId, runId: run.id },
        'Website provider acceptance unknown; operator reconciliation required',
      );
      await scope.websites.updateRun(run.id, {
        status: 'failed',
        failureReason: 'provider_acceptance_unknown',
        finishedAt: new Date(),
        leaseUntil: null,
      });
      await scope.billing.release(operationId);
      await failOnboardingScan(scope, run, 'unreachable');
      return true;
    }
    if (!(await scope.websites.claimProvider(scanId))) throw new Error('website_provider_busy');
    let result: WebsiteScanResult;
    try {
      result = await scanPublicWebsite(source.url, {
        firecrawlApiKey: getEnv().FIRECRAWL_API_KEY ?? '',
        ...(crawlId ? { crawlId } : {}),
        onCrawlStarted: async (id) => {
          await scope.onboarding.saveWebsiteCrawlId({
            scanId,
            url: source.url,
            websiteSubject: source.subject,
            crawlId: id,
          });
          const latest = await scope.websites.get(source.id);
          if (latest.paused || latest.archivedAt || getEnv().WEBSITE_CRAWLS_DISABLED)
            await cancelWebsiteCrawl(id, getEnv().FIRECRAWL_API_KEY ?? '').catch(() => undefined);
        },
      });
    } catch (error) {
      if (error instanceof Error && 'providerRejected' in error && error.providerRejected === true)
        await scope.websites.updateRun(scanId, { providerStartedAt: null });
      throw error;
    } finally {
      await scope.websites.updateRun(scanId, { leaseUntil: null });
    }
    await scope.websites.updateRun(scanId, { providerFinishedAt: new Date() });
    const costPerCredit = getEnv().FIRECRAWL_COST_EUR_PER_CREDIT;
    if (result.providerCredits !== undefined)
      await scope.websites.updateRun(scanId, {
        providerCredits: result.providerCredits,
        estimatedProviderCostEur:
          costPerCredit === undefined ? null : result.providerCredits * costPerCredit,
      });
    if (!result.ok) {
      await scope.websites.updateRun(scanId, {
        status: 'failed',
        failureReason: result.reason,
        finishedAt: new Date(),
        leaseUntil: null,
      });
      await scope.billing.release(operationId);
      await failOnboardingScan(scope, run, result.reason);
      return true;
    }
    failureReason = result.partialFailureReason ?? null;
    await scope.websites.updateRun(scanId, { failureReason });
    pages = await scope.onboarding.saveWebsiteScanPages({
      scanId,
      url: source.url,
      websiteSubject: source.subject,
      pages: result.pages,
    });
  }
  const sourceUnits = websiteSourceUnits(pages.length, run.unitsPerPage);
  await settleCapturedWebsiteRun(db, teamId, scanId);
  const latestSource = await scope.websites.get(source.id);
  if (latestSource.paused || latestSource.archivedAt) {
    await scope.websites.updateRun(scanId, {
      sourceUnits,
      pageCount: pages.length,
      status: 'cancelled',
      finishedAt: new Date(),
      leaseUntil: null,
    });
    await failOnboardingScan(scope, run, 'unreachable');
    return true;
  }
  await scope.websites.updateRun(scanId, {
    status: 'processing',
    pageCount: pages.length,
    sourceUnits,
    leaseUntil: null,
  });
  let changed = 0;
  let firstEvent: string | undefined;
  for (const page of pages) {
    const current = await scope.websites.page(source.id, page.url);
    if (current?.contentHash === websiteContentHash(page.text)) {
      const previous = current.currentEventId
        ? (await scope.timeline.getEventsByIds([current.currentEventId]))[0]
        : null;
      const metadata = previous?.sourceMetadata as Record<string, unknown> | undefined;
      if (previous && metadata?.websiteScanId !== scanId) {
        firstEvent ??= previous.id;
        continue;
      }
    }
    changed++;
    const event = await scope.timeline.createEvent({
      idempotencyKey: `website-scan:${scanId}:${page.url}`,
      authorUserId: run.principal?.authType === 'api_key' ? null : userId,
      source: 'web',
      contentText: renderWebsitePageContent(page),
      visibility: 'team',
      visibilityOwnerUserId: run.principal?.authType === 'api_key' ? null : userId,
      sourceMetadata: {
        websiteId: source.id,
        websiteScanId: scanId,
        websiteSubject: source.subject,
        pageUrl: page.url,
        pageHost: source.hostname,
        pageTitle: page.title,
        websiteContentHash: websiteContentHash(page.text),
        firstRunWebsiteScan: run.trigger === 'onboarding',
      },
    });
    firstEvent ??= event.id;
    const saved = await scope.onboarding.saveWebsitePageDocument({
      scanId,
      eventId: event.id,
      page,
      websiteId: source.id,
    });
    for (const chunkId of saved.chunkIds) await enqueueDocChunkEmbedJob(teamId, chunkId);
    await enqueueExtractJob({ rawEventId: event.id, teamId });
  }
  if (run.trigger === 'onboarding' && firstEvent)
    await scope.onboarding.attachCapture({
      eventId: firstEvent,
      landed: true,
      requireStarterPath: 'website',
      websiteScanId: scanId,
    });
  await scope.websites.updateRun(scanId, {
    changedCount: changed,
    handoffAt: new Date(),
    ...(changed === 0
      ? { status: failureReason ? 'partial' : 'completed', finishedAt: new Date() }
      : {}),
  });
  return true;
}
