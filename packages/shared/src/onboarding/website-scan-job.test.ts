import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { describe, it } from 'bun:test';

import { processWebsiteScanJob } from '#src/onboarding/website-scan-job.js';

import type { FirstRunState } from '#src/onboarding/first-run.js';
import type { WebsiteScanFetch } from '#src/onboarding/website-scan.js';

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

function html(body: string): string {
  return `<html><head><title>Studio</title></head><body><p>${body} ${'named work '.repeat(10)}</p></body></html>`;
}

function fetchPages(pages: Record<string, string | number>): WebsiteScanFetch {
  return (input) => {
    const url = String(input);
    const value = pages[url] ?? pages[`${url}/`] ?? 404;
    if (typeof value === 'number') {
      return Promise.resolve(new Response('missing', { status: value }));
    }
    return Promise.resolve(
      new Response(value, { status: 200, headers: { 'content-type': 'text/html' } }),
    );
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
      getFirstRun: () => Promise.resolve(firstRun()),
      createEvent,
      attachCapture,
      markScanFailed,
      enqueueExtract,
      fetchPage: fetchPages({
        'https://studio.example/robots.txt': 404,
        'https://studio.example/': html('Design sprints for B2B teams.'),
      }),
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
      getFirstRun: () => Promise.resolve(firstRun()),
      createEvent,
      attachCapture,
      markScanFailed,
      enqueueExtract: () => Promise.resolve(undefined),
      fetchPage: fetchPages({
        'https://studio.example/robots.txt': 'User-agent: *\nDisallow: /\n',
        'https://studio.example/': html('Hidden'),
      }),
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
      getFirstRun: () => Promise.resolve(firstRun()),
      createEvent: () => Promise.resolve({ id: 'event-home' }),
      attachCapture,
      markScanFailed: () => Promise.resolve({}),
      enqueueExtract,
      admitEnrichment,
      fetchPage: fetchPages({
        'https://studio.example/robots.txt': 404,
        'https://studio.example/': html('Design sprints for B2B teams.'),
      }),
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
        getFirstRun: () => Promise.resolve(firstRun()),
        createEvent: () => Promise.resolve({ id: 'event-home' }),
        attachCapture,
        markScanFailed: () => Promise.resolve({}),
        enqueueExtract: () => Promise.reject(new Error('redis down')),
        fetchPage: fetchPages({
          'https://studio.example/robots.txt': 404,
          'https://studio.example/': html('Design sprints for B2B teams.'),
        }),
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
      getFirstRun: () => {
        calls += 1;
        if (calls === 1) return Promise.resolve(firstRun());
        return Promise.resolve(firstRun({ starterPath: 'email', websiteUrl: null }));
      },
      createEvent: () => Promise.resolve({ id: 'event-home' }),
      attachCapture,
      markScanFailed,
      enqueueExtract: () => Promise.resolve(undefined),
      fetchPage: fetchPages({
        'https://studio.example/robots.txt': 'User-agent: *\nDisallow: /\n',
        'https://studio.example/': html('Hidden'),
      }),
    });
    expect(markScanFailed).not.toHaveBeenCalled();
    expect(attachCapture).not.toHaveBeenCalled();
  });
});
