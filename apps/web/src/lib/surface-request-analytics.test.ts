import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { capture } = vi.hoisted(() => ({ capture: vi.fn().mockResolvedValue(undefined) }));

vi.mock('@/lib/analytics', () => ({ capturePersonlessSurfaceRequest: capture }));

import {
  isCountableSurfaceNavigation,
  schedulePersonlessSurfaceRequest,
} from '@/lib/surface-request-analytics';

function request(path: string, headers: Record<string, string> = { accept: 'text/html' }) {
  return new NextRequest(`https://thetimeline.cc${path}`, { headers });
}

function context() {
  return { waitUntil: vi.fn() };
}

beforeEach(() => vi.clearAllMocks());

describe('personless surface request scheduling', () => {
  it('counts full-document and non-prefetch RSC navigations', () => {
    expect(isCountableSurfaceNavigation(request('/'))).toBe(true);
    expect(isCountableSurfaceNavigation(request('/app/timeline', { rsc: '1' }))).toBe(true);
    expect(
      isCountableSurfaceNavigation(
        request('/app/timeline', { rsc: '1', 'next-router-prefetch': '1' }),
      ),
    ).toBe(false);
    const prefetchHeaderCases: Record<string, string>[] = [
      { accept: 'text/html', 'next-router-prefetch': '1' },
      { accept: 'text/html', 'x-middleware-prefetch': '1' },
      { accept: 'text/html', purpose: 'prefetch' },
      { accept: 'text/html', 'sec-purpose': 'prefetch;prerender' },
    ];
    for (const headers of prefetchHeaderCases) {
      expect(isCountableSurfaceNavigation(request('/privacy', headers))).toBe(false);
    }
  });

  it('schedules exact public and app surface captures without forwarding request data', () => {
    const publicContext = context();
    schedulePersonlessSurfaceRequest(request('/help/capture'), new Response(null), publicContext);
    expect(capture).toHaveBeenNthCalledWith(1, 'public', 'help_capture');
    expect(publicContext.waitUntil).toHaveBeenCalledOnce();

    const appContext = context();
    schedulePersonlessSurfaceRequest(
      request('/app/boards/raw-board-id'),
      new Response(null),
      appContext,
    );
    expect(capture).toHaveBeenNthCalledWith(2, 'app', 'board_detail');
    expect(JSON.stringify(capture.mock.calls)).not.toContain('raw-board-id');
    expect(appContext.waitUntil).toHaveBeenCalledOnce();
  });

  it('does not count redirects, errors, APIs, unknown routes, or prefetches', () => {
    for (const [req, response] of [
      [request('/app/timeline'), Response.redirect('https://thetimeline.cc/sign-in')],
      [request('/app/timeline'), new Response(null, { status: 500 })],
      [request('/api/health'), new Response(null)],
      [request('/new-unreviewed-page'), new Response(null)],
      [request('/privacy', { accept: 'text/html', purpose: 'prefetch' }), new Response(null)],
    ] as const) {
      schedulePersonlessSurfaceRequest(req, response, context());
    }
    expect(capture).not.toHaveBeenCalled();
  });
});
