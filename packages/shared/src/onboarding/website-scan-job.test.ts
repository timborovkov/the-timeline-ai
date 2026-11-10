// A scan must admit billing before provider work, preserve retry evidence, and never write canonical records.
import { expect, vi } from '@timeline/test-support';
import { describe, it } from 'bun:test';

import {
  processWebsiteScanJob,
  type WebsiteScanJobDeps,
} from '#src/onboarding/website-scan-job.js';

import type { FirstRunState } from '#src/onboarding/first-run.js';

const scanId = '33333333-3333-4333-8333-333333333333';
const state: FirstRunState = {
  teamId: '11111111-1111-4111-8111-111111111111',
  startedByUserId: '22222222-2222-4222-8222-222222222222',
  phase: 'processing',
  starterPath: 'website',
  starterSelectedAt: new Date(),
  captureDocumentId: null,
  captureEventId: null,
  websiteUrl: 'https://studio.example/',
  websiteHost: 'studio.example',
  websiteSubject: 'own_team',
  websiteScanId: scanId,
  scanFailureReason: null,
  guideHiddenAt: null,
  firstCaptureLandedAt: null,
  workStyle: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};
const pages = [
  {
    url: 'https://studio.example/',
    title: 'Studio',
    text: 'Studio builds software for public companies. '.repeat(4),
  },
];
function fixture(overrides: Partial<WebsiteScanJobDeps> = {}) {
  const deps = {
    scanId,
    userId: '22222222-2222-4222-8222-222222222222',
    firecrawlApiKey: 'fc-test',
    getFirstRun: vi.fn(() => Promise.resolve(state)),
    reserve: vi.fn(() => Promise.resolve(true)),
    settle: vi.fn(() => Promise.resolve()),
    release: vi.fn(() => Promise.resolve()),
    getCrawlId: () => Promise.resolve(null),
    saveCrawlId: () => Promise.resolve(),
    getPages: vi.fn(() => Promise.resolve(pages)),
    savePages: vi.fn(() => Promise.resolve(pages)),
    saveDocument: vi.fn(() => Promise.resolve({})),
    createEvent: vi.fn(() => Promise.resolve({ id: 'event-home' })),
    attachCapture: vi.fn(() => Promise.resolve({})),
    markScanFailed: vi.fn(() => Promise.resolve({})),
    enqueueExtract: vi.fn(() => Promise.resolve()),
    firecrawlFetch: vi.fn(() =>
      Promise.resolve(
        Response.json({
          id: 'crawl-1',
          status: 'completed',
          data: pages.map((page) => ({
            markdown: page.text,
            metadata: { sourceURL: page.url, title: page.title },
          })),
        }),
      ),
    ),
    ...overrides,
  };
  return deps;
}
describe('website scan job', () => {
  it('persists documents and cited web events, settles one page once and enqueues extraction', async () => {
    const deps = fixture();
    await processWebsiteScanJob(deps);
    expect(deps.settle).toHaveBeenCalledWith(1);
    expect(deps.createEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'web',
        sourceMetadata: expect.objectContaining({
          websiteScanId: scanId,
          websiteSubject: 'own_team',
          pageUrl: 'https://studio.example/',
        }) as Record<string, unknown>,
      }),
    );
    expect(deps.saveDocument).toHaveBeenCalledWith({
      scanId,
      eventId: 'event-home',
      page: pages[0],
    });
    expect(deps.enqueueExtract).toHaveBeenCalledWith({
      teamId: state.teamId,
      rawEventId: 'event-home',
    });
    expect(deps.attachCapture).toHaveBeenCalledWith({
      eventId: 'event-home',
      landed: true,
      requireStarterPath: 'website',
      websiteScanId: scanId,
    });
    expect(deps.firecrawlFetch).not.toHaveBeenCalled();
  });
  it('does not call Firecrawl or persist events when billing refuses admission', async () => {
    const deps = fixture({
      reserve: () => Promise.resolve(false),
      getPages: () => Promise.resolve(null),
    });
    await processWebsiteScanJob(deps);
    expect(deps.firecrawlFetch).not.toHaveBeenCalled();
    expect(deps.createEvent).not.toHaveBeenCalled();
    expect(deps.release).toHaveBeenCalled();
  });
  it('requires the key before provider work', async () => {
    const deps = fixture({ firecrawlApiKey: '' });
    await expect(processWebsiteScanJob(deps)).rejects.toThrow('FIRECRAWL_API_KEY is required');
    expect(deps.firecrawlFetch).not.toHaveBeenCalled();
  });
  it('ignores jobs for an older selection even when its URL is identical', async () => {
    const deps = fixture({
      getFirstRun: () => Promise.resolve({ ...state, websiteScanId: 'new-selection' }),
    });
    await processWebsiteScanJob(deps);
    expect(deps.createEvent).not.toHaveBeenCalled();
    expect(deps.attachCapture).not.toHaveBeenCalled();
  });
  it('propagates extraction enqueue failures without completing and reuses snapshots on retry', async () => {
    let fail = true;
    const deps = fixture({
      enqueueExtract: () =>
        fail ? Promise.reject(new Error('Redis unavailable')) : Promise.resolve(),
    });
    await expect(processWebsiteScanJob(deps)).rejects.toThrow('Redis unavailable');
    expect(deps.attachCapture).not.toHaveBeenCalled();
    fail = false;
    await processWebsiteScanJob(deps);
    expect(deps.firecrawlFetch).not.toHaveBeenCalled();
    expect(deps.createEvent).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        idempotencyKey: `website-scan:${scanId}:https://studio.example/`,
      }),
    );
    expect(deps.attachCapture).toHaveBeenCalledTimes(1);
  });
  it('does not persist a crawl that finishes after switching paths', async () => {
    let current = state;
    const deps = fixture({
      getPages: () => Promise.resolve(null),
      getFirstRun: () => Promise.resolve(current),
      savePages: () => {
        current = { ...state, starterPath: 'email' };
        return Promise.resolve(pages);
      },
    });
    await processWebsiteScanJob(deps);
    expect(deps.createEvent).not.toHaveBeenCalled();
    expect(deps.attachCapture).not.toHaveBeenCalled();
  });
  it('preserves the other-company subject in evidence', async () => {
    const deps = fixture({
      getFirstRun: () => Promise.resolve({ ...state, websiteSubject: 'other_company' }),
    });
    await processWebsiteScanJob(deps);
    expect(deps.createEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceMetadata: expect.objectContaining({ websiteSubject: 'other_company' }) as Record<
          string,
          unknown
        >,
      }),
    );
  });
});
