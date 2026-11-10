import { getEnv } from '#src/env.js';
import {
  type FirstRunScanFailureReason,
  type FirstRunState,
  type WebsiteSubject,
} from '#src/onboarding/first-run.js';
import {
  renderWebsitePageContent,
  scanPublicWebsite,
  type WebsiteScanDeps,
  type WebsiteScanPage,
} from '#src/onboarding/website-scan.js';
import { enqueueExtractJob } from '#src/queue/queues.js';

export interface WebsiteScanJobDeps extends WebsiteScanDeps {
  userId: string;
  scanId: string;
  getFirstRun: () => Promise<FirstRunState | null>;
  reserve: () => Promise<boolean>;
  settle: (pageCount: number) => Promise<void>;
  release: () => Promise<void>;
  getPages: () => Promise<WebsiteScanPage[] | null>;
  savePages: (input: {
    scanId: string;
    url: string;
    websiteSubject: WebsiteSubject;
    pages: WebsiteScanPage[];
  }) => Promise<WebsiteScanPage[]>;
  saveDocument: (input: {
    scanId: string;
    eventId: string;
    page: WebsiteScanPage;
  }) => Promise<unknown>;
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
    websiteScanId: string;
  }) => Promise<unknown>;
  markScanFailed: (reason: FirstRunScanFailureReason, scanId: string) => Promise<unknown>;
  enqueueExtract?: typeof enqueueExtractJob;
}

export async function processWebsiteScanJob(deps: WebsiteScanJobDeps): Promise<void> {
  const active = (state: FirstRunState | null) =>
    state?.starterPath === 'website' &&
    state.websiteScanId === deps.scanId &&
    state.phase === 'processing';
  const firstRun = await deps.getFirstRun();
  if (!active(firstRun) || !firstRun?.websiteUrl) {
    await deps.release();
    return;
  }
  const apiKey = deps.firecrawlApiKey ?? getEnv().FIRECRAWL_API_KEY;
  if (!apiKey?.trim()) throw new Error('FIRECRAWL_API_KEY is required for website scanning.');
  let pages = await deps.getPages();
  // Recheck admission in the worker: a queued reservation may have expired.
  if (!(await deps.reserve())) {
    await deps.markScanFailed('rate_limited', deps.scanId);
    await deps.release();
    return;
  }
  if (!pages) {
    const result = await scanPublicWebsite(firstRun.websiteUrl, {
      ...deps,
      firecrawlApiKey: apiKey,
    });
    if (!result.ok) {
      await deps.markScanFailed(result.reason, deps.scanId);
      await deps.release();
      return;
    }
    pages = await deps.savePages({
      scanId: deps.scanId,
      url: firstRun.websiteUrl,
      websiteSubject: firstRun.websiteSubject,
      pages: result.pages,
    });
  }
  if (!(await deps.getFirstRun().then(active))) {
    await deps.release();
    return;
  }
  if (!pages.length) {
    await deps.markScanFailed('no_readable_text', deps.scanId);
    await deps.release();
    return;
  }
  // One scan settlement, one accepted-source unit per page. AI remains separately metered.
  await deps.settle(pages.length);
  let firstId: string | null = null;
  for (const page of pages) {
    const event = await deps.createEvent({
      idempotencyKey: `website-scan:${deps.scanId}:${page.url}`,
      authorUserId: deps.userId,
      source: 'web',
      contentText: renderWebsitePageContent(page),
      visibility: 'team',
      visibilityOwnerUserId: deps.userId,
      sourceMetadata: {
        firstRunWebsiteScan: true,
        websiteScanId: deps.scanId,
        websiteSubject: firstRun.websiteSubject,
        pageUrl: page.url,
        pageHost: firstRun.websiteHost,
        pageTitle: page.title,
      },
    });
    firstId ??= event.id;
    await deps.saveDocument({ scanId: deps.scanId, eventId: event.id, page });
    await (deps.enqueueExtract ?? enqueueExtractJob)({
      rawEventId: event.id,
      teamId: firstRun.teamId,
    });
  }
  if (firstId)
    await deps.attachCapture({
      eventId: firstId,
      landed: true,
      requireStarterPath: 'website',
      websiteScanId: deps.scanId,
    });
}
