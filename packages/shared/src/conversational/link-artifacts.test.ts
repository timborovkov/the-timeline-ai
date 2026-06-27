import { describe, expect, it } from 'vitest';

import { extractLinksFromText, linkMetadata } from '#src/conversational/link-artifacts.js';

describe('conversational link artifacts', () => {
  it('extracts and normalizes Slack and bare links without tracking or secret params', () => {
    const links = extractLinksFromText(
      'Review <https://github.com/Tim/Repo/pull/7?utm_source=slack&token=secret#frag|PR 7> and https://example.com/path/?b=2&a=1.',
    );

    expect(linkMetadata(links)).toEqual([
      {
        canonical_url: 'https://github.com/Tim/Repo/pull/7',
        display_url: 'github.com/Tim/Repo/pull/7',
        domain: 'github.com',
        label: 'PR 7',
        provider: 'github',
        provider_object_id: 'Tim/Repo#7',
      },
      {
        canonical_url: 'https://example.com/path?a=1&b=2',
        display_url: 'example.com/path',
        domain: 'example.com',
        label: null,
        provider: null,
        provider_object_id: null,
      },
    ]);
  });

  it('keeps meaningful query params while stripping exact secret-like names', () => {
    const links = extractLinksFromText(
      [
        'https://example.com/report?reference=alpha&author=mika&token=secret&api_key=hidden',
        'https://example.com/report?reference=beta&author=mika&accessToken=hidden&code_verifier=hidden',
        'https://example.com/report?promo_code=summer&country_code=EE&x-api-key=hidden&code-challenge=hidden',
      ].join(' '),
    );

    expect(linkMetadata(links).map((link) => link.canonical_url)).toEqual([
      'https://example.com/report?author=mika&reference=alpha',
      'https://example.com/report?author=mika&reference=beta',
      'https://example.com/report?country_code=EE&promo_code=summer',
    ]);
  });
});
