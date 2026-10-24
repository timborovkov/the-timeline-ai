import { describe, expect, it } from 'vitest';

import type { CaptureResult } from 'posthog-js';

import { sanitizeBrowserAnalyticsEvent } from '@/lib/browser-analytics';

const paths = new Set(['/', '/how-it-works', '/sign-in']);

describe('browser analytics privacy', () => {
  it('keeps public page paths and referrer domains while removing queries, fragments and titles', () => {
    const event: CaptureResult = {
      uuid: 'pageview-test',
      event: '$pageview',
      properties: {
        $current_url: 'https://thetimeline.cc/how-it-works?email=private@example.com#secret',
        $pathname: '/how-it-works',
        $referrer: 'https://search.example/results?q=private+project#secret',
        $referring_domain: 'search.example',
        $title: 'Private document name',
        utm_campaign: 'private-project',
        $search_keyword: 'private project',
        ph_keyword: 'private search',
        distinct_id: 'anonymous-visitor',
        $session_id: 'session',
      },
    };
    const result = sanitizeBrowserAnalyticsEvent(event, paths);
    expect(result?.properties).toEqual({
      $current_url: 'https://thetimeline.cc/how-it-works',
      $pathname: '/how-it-works',
      $referrer: 'https://search.example',
      $referring_domain: 'search.example',
      distinct_id: 'anonymous-visitor',
      $session_id: 'session',
    });
    expect(event.properties.$current_url).toContain('private@example.com');
  });

  it.each([
    '/app/documents/private-document',
    '/accept-invite/secret-token',
    '/verify-email/secret-token',
    '/unknown/private-path',
  ])('does not count a private or unknown pageview: %s', (path) => {
    expect(
      sanitizeBrowserAnalyticsEvent(
        {
          uuid: 'test',
          event: '$pageview',
          properties: { $current_url: `https://thetimeline.cc${path}` },
        },
        paths,
      ),
    ).toBeNull();
  });

  it('scrubs both SDK person-property locations and session metadata on identity events', () => {
    const sensitive = {
      $initial_current_url: 'https://thetimeline.cc/accept-invite/secret?token=secret',
      $initial_referrer: 'https://referrer.example/private?email=private@example.com',
      $initial_pathname: '/app/documents/private-document',
      $initial_utm_source: 'private-project',
    };
    const result = sanitizeBrowserAnalyticsEvent(
      {
        uuid: 'identity-test',
        event: '$identify',
        properties: {
          distinct_id: 'user-id',
          $session_entry_url: 'https://thetimeline.cc/verify-email/secret-token',
          $set_once: sensitive,
        },
        $set: sensitive,
        $set_once: sensitive,
      },
      paths,
    );
    const safe = {
      $initial_current_url: 'https://thetimeline.cc/',
      $initial_referrer: 'https://referrer.example',
      $initial_pathname: '/',
    };
    expect(result?.$set).toEqual(safe);
    expect(result?.$set_once).toEqual(safe);
    expect(result?.properties).toEqual({
      distinct_id: 'user-id',
      $session_entry_url: 'https://thetimeline.cc/',
      $set_once: safe,
    });
  });

  it('rejects recordings and malformed or non-web page URLs', () => {
    for (const event of [
      { uuid: 'test', event: '$snapshot', properties: {} },
      { uuid: 'test', event: '$pageview', properties: { $current_url: 'not a URL' } },
      { uuid: 'test', event: '$pageview', properties: { $current_url: 'javascript:void(0)' } },
    ]) {
      expect(sanitizeBrowserAnalyticsEvent(event, paths)).toBeNull();
    }
  });
});
