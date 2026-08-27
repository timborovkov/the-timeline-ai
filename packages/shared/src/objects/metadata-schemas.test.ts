import { describe, expect, it } from 'vitest';

import {
  mergeObjectMetadata,
  parseObjectMetadataPatch,
  readableMetadataEntries,
} from '#src/objects/metadata-schemas.js';

describe('object metadata schemas', () => {
  it('merges metadata patches and removes empty values', () => {
    expect(
      mergeObjectMetadata(
        { domain: 'acme.example', role: 'legacy', seed: true },
        { domain: 'northstar.example', website: '  ', relationship: 'partner' },
      ),
    ).toEqual({
      domain: 'northstar.example',
      role: 'legacy',
      seed: true,
      relationship: 'partner',
    });
  });

  it('validates company metadata patches', () => {
    const parsed = parseObjectMetadataPatch('company', {
      domain: 'northstar.example',
      website: 'https://northstar.example',
    });
    expect(parsed).toEqual({
      ok: true,
      patch: { domain: 'northstar.example', website: 'https://northstar.example' },
    });
  });

  it('accepts arbitrary custom metadata keys for any object type', () => {
    expect(parseObjectMetadataPatch('project', { region: 'EMEA' })).toEqual({
      ok: true,
      patch: { region: 'EMEA' },
    });
    expect(parseObjectMetadataPatch('person', { role: 'Lead', badge: 'VIP' })).toEqual({
      ok: true,
      patch: { role: 'Lead', badge: 'VIP' },
    });
  });

  it('rejects reserved and contact metadata keys', () => {
    expect(parseObjectMetadataPatch('company', { fixture_version: 'x' })).toEqual({
      ok: false,
      error: 'Metadata key “fixture_version” is reserved',
    });
    expect(parseObjectMetadataPatch('person', { email: 'a@b.example' })).toEqual({
      ok: false,
      error: 'Use Contact for email, not Details',
    });
  });

  it('hides internal and contact keys from readable metadata entries', () => {
    expect(
      readableMetadataEntries('person', {
        role: 'Customer lead',
        email: 'elena@example.com',
        display_title: 'hidden',
        fixture_version: 'demo-seed-v1',
        note: 'Preferred contact via Slack',
      }),
    ).toEqual([
      { key: 'role', value: 'Customer lead' },
      { key: 'note', value: 'Preferred contact via Slack' },
    ]);
  });
});
