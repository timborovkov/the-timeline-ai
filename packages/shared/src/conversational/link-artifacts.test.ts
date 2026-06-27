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
});
