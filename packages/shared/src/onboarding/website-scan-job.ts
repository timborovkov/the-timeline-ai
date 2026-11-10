import { getEnv } from '#src/env.js';
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
  attachCapture: (input: {
    eventId: string;
    landed: boolean;
    requireStarterPath: 'website';
  }) => Promise<unknown>;
  markScanFailed: (reason: FirstRunScanFailureReason) => Promise<unknown>;
  enqueueExtract?: typeof enqueueExtractJob;
  admitEnrichment?: (rawEventId: string) => Promise<boolean>;
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

function isActiveWebsiteScan(state: FirstRunState | null, websiteUrl: string): boolean {
  return (
    state?.starterPath === 'website' &&
    state.websiteUrl === websiteUrl &&
    state.phase === 'processing'
  );
}

async function persistWebsiteScanPages(input: {
  userId: string;
  host: string;
  pages: WebsiteScanPage[];
  createEvent: WebsiteScanJobDeps['createEvent'];
  enqueueExtract: typeof enqueueExtractJob;
  admitEnrichment?: (rawEventId: string) => Promise<boolean>;
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
    const admitted = input.admitEnrichment ? await input.admitEnrichment(event.id) : true;
    if (!admitted) continue;
    await input.enqueueExtract({ rawEventId: event.id, teamId: input.teamId });
  }
  return firstId;
}

export async function processWebsiteScanJob(deps: WebsiteScanJobDeps): Promise<void> {
  const env =
    deps.websiteScanEnabled === undefined || deps.firecrawlApiKey === undefined
      ? getEnv()
      : undefined;
  const enabled = deps.websiteScanEnabled ?? (env ? isWebsiteScanEnabled(env) : false);
  const firecrawlApiKey = deps.firecrawlApiKey ?? env?.FIRECRAWL_API_KEY;
  const firstRun = await deps.getFirstRun();
  if (!firstRun?.websiteUrl || !isActiveWebsiteScan(firstRun, firstRun.websiteUrl)) {
    return;
  }
  const websiteUrl = firstRun.websiteUrl;
  if (firstRun.firstCaptureLandedAt && firstRun.captureEventId) {
    return;
  }
  if (!enabled || !firecrawlApiKey) {
    await deps.markScanFailed('not_enabled');
    return;
  }

  const result = await scanPublicWebsite(websiteUrl, {
    firecrawlApiKey,
    ...(deps.fetchPage ? { fetchPage: deps.fetchPage } : {}),
    ...(deps.now ? { now: deps.now } : {}),
    ...(deps.firecrawlFetch ? { firecrawlFetch: deps.firecrawlFetch } : {}),
    ...(deps.sleep ? { sleep: deps.sleep } : {}),
  });

  const latest = await deps.getFirstRun();
  if (!isActiveWebsiteScan(latest, websiteUrl)) {
    return;
  }

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
    enqueueExtract: deps.enqueueExtract ?? enqueueExtractJob,
    ...(deps.admitEnrichment ? { admitEnrichment: deps.admitEnrichment } : {}),
    teamId: firstRun.teamId,
  });

  const afterPersist = await deps.getFirstRun();
  if (!isActiveWebsiteScan(afterPersist, websiteUrl)) {
    return;
  }
  if (!firstId) {
    await deps.markScanFailed('no_readable_text');
    return;
  }
  await deps.attachCapture({ eventId: firstId, landed: true, requireStarterPath: 'website' });
}
