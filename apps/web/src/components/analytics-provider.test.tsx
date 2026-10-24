// @vitest-environment happy-dom

import { cleanup, render } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PostHogConfig } from 'posthog-js';
import type { ReactNode } from 'react';

const mocks = vi.hoisted(() => ({
  pathname: '/',
  client: {
    init: vi.fn<(key: string, config: Partial<PostHogConfig>) => void>(),
    capture: vi.fn<(event: string, properties: Record<string, unknown>) => void>(),
    identify: vi.fn(),
    group: vi.fn(),
  },
}));

vi.mock('posthog-js', () => ({ default: mocks.client }));
vi.mock('posthog-js/react', () => ({
  PostHogProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('next/navigation', () => ({ usePathname: () => mocks.pathname }));

vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', 'phc_website_test');
const { AnalyticsProvider, WebsiteAnalytics } = await import('@/components/analytics-provider');
const paths = ['/', '/how-it-works', '/sign-in'];

beforeEach(() => {
  mocks.pathname = '/';
  mocks.client.capture.mockClear();
  mocks.client.identify.mockClear();
  mocks.client.group.mockClear();
});
afterEach(cleanup);
afterAll(() => vi.unstubAllEnvs());

describe('website analytics', () => {
  it('counts an anonymous public visit once under React strict mode, with recordings disabled', () => {
    render(
      <StrictMode>
        <WebsiteAnalytics paths={paths} />
      </StrictMode>,
    );
    expect(mocks.client.capture).toHaveBeenCalledExactlyOnceWith('$pageview', {
      $current_url: window.location.origin + '/',
      $pathname: '/',
      $referrer: '$direct',
    });
    expect(mocks.client.identify).not.toHaveBeenCalled();
    expect(mocks.client.init).toHaveBeenCalledTimes(1);
    const [key, config] = mocks.client.init.mock.calls[0] ?? [];
    expect(key).toBe('phc_website_test');
    expect(config).toMatchObject({
      autocapture: false,
      capture_pageview: false,
      capture_pageleave: false,
      disable_session_recording: true,
    });
    expect(config?.before_send).toBeTypeOf('function');
  });

  it('counts client navigation and returning visits while excluding private routes and rerenders', () => {
    const view = render(<WebsiteAnalytics paths={paths} />);
    view.rerender(<WebsiteAnalytics paths={[...paths]} />);
    mocks.pathname = '/how-it-works';
    view.rerender(<WebsiteAnalytics paths={paths} />);
    mocks.pathname = '/app/documents/private-id';
    view.rerender(<WebsiteAnalytics paths={paths} />);
    mocks.pathname = '/how-it-works';
    view.rerender(<WebsiteAnalytics paths={paths} />);
    expect(mocks.client.capture.mock.calls.map(([, properties]) => properties.$pathname)).toEqual([
      '/',
      '/how-it-works',
      '/how-it-works',
    ]);
  });

  it('shares initialization with authenticated analytics and preserves team identity', () => {
    render(
      <AnalyticsProvider userId="user-id" teamId="team-id">
        <WebsiteAnalytics paths={paths} />
      </AnalyticsProvider>,
    );
    expect(mocks.client.init).toHaveBeenCalledTimes(1);
    expect(mocks.client.identify).toHaveBeenCalledWith('user-id');
    expect(mocks.client.group).toHaveBeenCalledWith('team', 'team-id');
    expect(mocks.client.capture).toHaveBeenCalledTimes(1);
  });
});
