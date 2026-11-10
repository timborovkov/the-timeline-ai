import { getEnv } from '#src/env.js';
import { childLogger } from '#src/logger.js';
import {
  isWebsiteScanEnabled,
  type FirstRunScanFailureReason,
  type FirstRunState,
} from '#src/onboarding/first-run.js';
import {
  renderWebsitePageContent,
  scanPublicWebsite,
  type WebsiteScanDeps,
  type WebsiteScanPage,
} from '#src/onboarding/website-scan.js';
import { enqueueExtractJob } from '#src/queue/queues.js';

const log = childLogger('onboarding:website-scan');

const FIRST_RUN_WEBSITE_SCAN_META = 'firstRunWebsiteScan' as const;

export interface WebsiteScanJobDeps extends WebsiteScanDeps {
  userId: string;
  getFirstRun: () => Promise<FirstRunState | null>;
  createEvent: (input: {
    idempotencyKey: string;
    authorUserId: string;
    source: 'web';
    contentText: string;
    visibility: 'team';
    visibilityOwnerUserId: string;
    sourceMetadata: Record<string, unknown>;
  }) => Promise<{ id: string }>;
  attachCapture: (input: { eventId: string; landed: boolean }) => Promise<unknown>;
  markScanFailed: (reason: FirstRunScanFailureReason) => Promise<unknown>;
  enqueueExtract?: typeof enqueueExtractJob;
  websiteScanEnabled?: boolean;
}

function pageMetadata(page: WebsiteScanPage, host: string): Record<string, unknown> {
  return {
    [FIRST_RUN_WEBSITE_SCAN_META]: true,
    pageUrl: page.url,
    pageHost: host,
    pageTitle: page.title,
  };
}

async function persistWebsiteScanPages(input: {
  userId: string;
  host: string;
  pages: WebsiteScanPage[];
  createEvent: WebsiteScanJobDeps['createEvent'];
  attachCapture: WebsiteScanJobDeps['attachCapture'];
  enqueueExtract: typeof enqueueExtractJob;
  teamId: string;
}): Promise<string | null> {
  let firstId: string | null = null;
  for (const page of input.pages) {
    const event = await input.createEvent({
      idempotencyKey: `first-run-website:${page.url}`,
      authorUserId: input.userId,
      source: 'web',
      contentText: renderWebsitePageContent(page),
      visibility: 'team',
      visibilityOwnerUserId: input.userId,
      sourceMetadata: pageMetadata(page, input.host),
    });
    firstId ??= event.id;
    try {
      await input.enqueueExtract({ rawEventId: event.id, teamId: input.teamId });
    } catch (err) {
      log.error({ err, rawEventId: event.id }, 'failed to enqueue extract for website scan page');
    }
  }
  if (firstId) {
    await input.attachCapture({ eventId: firstId, landed: true });
  }
  return firstId;
}

export async function processWebsiteScanJob(deps: WebsiteScanJobDeps): Promise<void> {
  const enabled = deps.websiteScanEnabled ?? isWebsiteScanEnabled(getEnv());
  const firstRun = await deps.getFirstRun();
  if (firstRun?.starterPath !== 'website' || !firstRun.websiteUrl) {
    return;
  }
  if (
    firstRun.phase === 'failed' ||
    firstRun.phase === 'skipped' ||
    firstRun.phase === 'complete'
  ) {
    return;
  }
  if (firstRun.firstCaptureLandedAt && firstRun.captureEventId) {
    return;
  }
  if (!enabled) {
    await deps.markScanFailed('not_enabled');
    return;
  }

  const result = await scanPublicWebsite(firstRun.websiteUrl, {
    ...(deps.fetchPage ? { fetchPage: deps.fetchPage } : {}),
    ...(deps.now ? { now: deps.now } : {}),
  });
  if (!result.ok) {
    await deps.markScanFailed(result.reason);
    return;
  }
  if (result.pages.length === 0) {
    await deps.markScanFailed('no_readable_text');
    return;
  }

  const firstId = await persistWebsiteScanPages({
    userId: deps.userId,
    host: result.host,
    pages: result.pages,
    createEvent: deps.createEvent,
    attachCapture: deps.attachCapture,
    enqueueExtract: deps.enqueueExtract ?? enqueueExtractJob,
    teamId: firstRun.teamId,
  });
  if (!firstId) {
    await deps.markScanFailed('no_readable_text');
  }
}
