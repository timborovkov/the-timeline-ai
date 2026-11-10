import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { describe, it } from 'bun:test';

import {
  FIRECRAWL_API_ORIGIN,
  type FirecrawlFetch,
} from '#src/onboarding/firecrawl-website-scan.js';
import { processWebsiteScanJob } from '#src/onboarding/website-scan-job.js';

import type { FirstRunState } from '#src/onboarding/first-run.js';

const FIRECRAWL_KEY = 'fc-test';
const HOME = 'https://studio.example/';

function requestUrl(input: string | URL | Request): string {
  if (typeof input === 'string') return input;
  if (input instanceof Request) return input.url;
  return input.href;
}

function firecrawlFetch(options: {
  pages?: { url: string; title: string; markdown: string }[];
  robotsBlocked?: string[];
}): FirecrawlFetch {
  return (input, init) => {
    const url = requestUrl(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    if (url === `${FIRECRAWL_API_ORIGIN}/v2/crawl` && method === 'POST') {
      return Promise.resolve(Response.json({ id: 'crawl-1' }));
    }
    if (url.includes('/v2/crawl/crawl-1/errors')) {
      return Promise.resolve(
        Response.json({ errors: [], robotsBlocked: options.robotsBlocked ?? [] }),
      );
    }
    if (url.includes('/v2/crawl/crawl-1')) {
      return Promise.resolve(
        Response.json({
          status: 'completed',
          data: (options.pages ?? []).map((page) => ({
            markdown: page.markdown,
            metadata: { title: page.title, sourceURL: page.url, statusCode: 200 },
          })),
        }),
      );
    }
    return Promise.resolve(new Response('not found', { status: 404 }));
  };
}

function readableMarkdown(label: string): string {
  return `${label} ${'work record context '.repeat(8).trim()}`;
}

const TEAM_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';

function firstRun(overrides: Partial<FirstRunState> = {}): FirstRunState {
  return {
    teamId: TEAM_ID,
    startedByUserId: USER_ID,
    phase: 'processing',
    starterPath: 'website',
    starterSelectedAt: new Date('2026-11-09T00:00:00.000Z'),
    captureDocumentId: null,
    captureEventId: null,
    websiteUrl: 'https://studio.example/',
    websiteHost: 'studio.example',
    scanFailureReason: null,
    guideHiddenAt: null,
    firstCaptureLandedAt: null,
    workStyle: 'delivery',
    createdAt: new Date('2026-11-09T00:00:00.000Z'),
    updatedAt: new Date('2026-11-09T00:00:00.000Z'),
    ...overrides,
  };
}

describe('website scan job', () => {
  it('writes cited web events through createEvent and never creates objects', async () => {
    const createEvent = vi.fn(() => Promise.resolve({ id: 'event-home' }));
    const attachCapture = vi.fn(() => Promise.resolve({}));
    const markScanFailed = vi.fn(() => Promise.resolve({}));
    const enqueueExtract = vi.fn(() => Promise.resolve(undefined));
    const createObject = vi.fn();

    await processWebsiteScanJob({
      userId: USER_ID,
      websiteScanEnabled: true,
      firecrawlApiKey: FIRECRAWL_KEY,
      firecrawlFetch: firecrawlFetch({
        pages: [{ url: HOME, title: 'Studio', markdown: readableMarkdown('Design sprints') }],
      }),
      getFirstRun: () => Promise.resolve(firstRun()),
      createEvent,
      attachCapture,
      markScanFailed,
      enqueueExtract,
    });

    expect(createEvent).toHaveBeenCalledOnce();
    const created = (
      createEvent.mock.calls as unknown as [
        {
          source: string;
          visibility: string;
          authorUserId: string;
          contentText: string;
          sourceMetadata: Record<string, unknown>;
        },
      ][]
    )[0]?.[0];
    expect(created).toMatchObject({
      source: 'web',
      visibility: 'team',
      authorUserId: USER_ID,
      sourceMetadata: {
        firstRunWebsiteScan: true,
        pageUrl: 'https://studio.example/',
        pageHost: 'studio.example',
      },
    });
    expect(created?.contentText).toContain('https://studio.example/');
    expect(enqueueExtract).toHaveBeenCalledWith({ rawEventId: 'event-home', teamId: TEAM_ID });
    expect(attachCapture).toHaveBeenCalledWith({
      eventId: 'event-home',
      landed: true,
      requireStarterPath: 'website',
    });
    expect(markScanFailed).not.toHaveBeenCalled();
    expect(createObject).not.toHaveBeenCalled();
  });

  it('marks a failed scan and does not write events', async () => {
    const createEvent = vi.fn(() => Promise.resolve({ id: 'event-home' }));
    const attachCapture = vi.fn(() => Promise.resolve({}));
    const markScanFailed = vi.fn(() => Promise.resolve({}));

    await processWebsiteScanJob({
      userId: USER_ID,
      websiteScanEnabled: true,
      firecrawlApiKey: FIRECRAWL_KEY,
      firecrawlFetch: firecrawlFetch({ pages: [], robotsBlocked: [HOME] }),
      getFirstRun: () => Promise.resolve(firstRun()),
      createEvent,
      attachCapture,
      markScanFailed,
      enqueueExtract: () => Promise.resolve(undefined),
    });

    expect(markScanFailed).toHaveBeenCalledWith('robots');
    expect(createEvent).not.toHaveBeenCalled();
    expect(attachCapture).not.toHaveBeenCalled();
  });

  it('fail-closes when the scan flag is off', async () => {
    const markScanFailed = vi.fn(() => Promise.resolve({}));
    await processWebsiteScanJob({
      userId: USER_ID,
      websiteScanEnabled: false,
      firecrawlApiKey: FIRECRAWL_KEY,
      getFirstRun: () => Promise.resolve(firstRun()),
      createEvent: () => Promise.resolve({ id: 'x' }),
      attachCapture: () => Promise.resolve({}),
      markScanFailed,
    });
    expect(markScanFailed).toHaveBeenCalledWith('not_enabled');
  });

  it('fail-closes when the Firecrawl key is missing', async () => {
    const markScanFailed = vi.fn(() => Promise.resolve({}));
    await processWebsiteScanJob({
      userId: USER_ID,
      websiteScanEnabled: true,
      firecrawlApiKey: '',
      getFirstRun: () => Promise.resolve(firstRun()),
      createEvent: () => Promise.resolve({ id: 'x' }),
      attachCapture: () => Promise.resolve({}),
      markScanFailed,
    });
    expect(markScanFailed).toHaveBeenCalledWith('not_enabled');
  });

  it('admits accepted-source billing before extract and skips extract when denied', async () => {
    const enqueueExtract = vi.fn(() => Promise.resolve(undefined));
    const attachCapture = vi.fn(() => Promise.resolve({}));
    const admitEnrichment = vi.fn(() => Promise.resolve(false));
    await processWebsiteScanJob({
      userId: USER_ID,
      websiteScanEnabled: true,
      firecrawlApiKey: FIRECRAWL_KEY,
      firecrawlFetch: firecrawlFetch({
        pages: [{ url: HOME, title: 'Studio', markdown: readableMarkdown('Design sprints') }],
      }),
      getFirstRun: () => Promise.resolve(firstRun()),
      createEvent: () => Promise.resolve({ id: 'event-home' }),
      attachCapture,
      markScanFailed: () => Promise.resolve({}),
      enqueueExtract,
      admitEnrichment,
    });
    expect(admitEnrichment).toHaveBeenCalledWith('event-home');
    expect(enqueueExtract).not.toHaveBeenCalled();
    expect(attachCapture).toHaveBeenCalledWith({
      eventId: 'event-home',
      landed: true,
      requireStarterPath: 'website',
    });
  });

  it('does not mark the capture landed when extract enqueue fails', async () => {
    const attachCapture = vi.fn(() => Promise.resolve({}));
    await expect(
      processWebsiteScanJob({
        userId: USER_ID,
        websiteScanEnabled: true,
        firecrawlApiKey: FIRECRAWL_KEY,
        firecrawlFetch: firecrawlFetch({
          pages: [{ url: HOME, title: 'Studio', markdown: readableMarkdown('Design sprints') }],
        }),
        getFirstRun: () => Promise.resolve(firstRun()),
        createEvent: () => Promise.resolve({ id: 'event-home' }),
        attachCapture,
        markScanFailed: () => Promise.resolve({}),
        enqueueExtract: () => Promise.reject(new Error('redis down')),
      }),
    ).rejects.toThrow('redis down');
    expect(attachCapture).not.toHaveBeenCalled();
  });

  it('does not fail onboarding after the starter path has changed', async () => {
    const markScanFailed = vi.fn(() => Promise.resolve({}));
    const attachCapture = vi.fn(() => Promise.resolve({}));
    let calls = 0;
    await processWebsiteScanJob({
      userId: USER_ID,
      websiteScanEnabled: true,
      firecrawlApiKey: FIRECRAWL_KEY,
      firecrawlFetch: firecrawlFetch({ pages: [], robotsBlocked: [HOME] }),
      getFirstRun: () => {
        calls += 1;
        if (calls === 1) return Promise.resolve(firstRun());
        return Promise.resolve(firstRun({ starterPath: 'email', websiteUrl: null }));
      },
      createEvent: () => Promise.resolve({ id: 'event-home' }),
      attachCapture,
      markScanFailed,
      enqueueExtract: () => Promise.resolve(undefined),
    });
    expect(markScanFailed).not.toHaveBeenCalled();
    expect(attachCapture).not.toHaveBeenCalled();
  });
});
