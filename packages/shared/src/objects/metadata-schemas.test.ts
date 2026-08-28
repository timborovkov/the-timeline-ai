import { describe, expect, it } from 'vitest';

import {
  humanizeMetadataKey,
  mergeObjectMetadata,
  parseObjectMetadataPatch,
  readableMetadataEntries,
  slugifyMetadataLabel,
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

  it('slugifies human field names and accepts arbitrary keys', () => {
    expect(slugifyMetadataLabel('Lost reason')).toBe('lostReason');
    expect(humanizeMetadataKey('lostReason')).toBe('Lost reason');
    expect(humanizeMetadataKey('close_date')).toBe('Close date');
    expect(parseObjectMetadataPatch('project', { 'Lost reason': 'Requested on-prem' })).toEqual({
      ok: true,
      patch: { lostReason: 'Requested on-prem' },
    });
    expect(parseObjectMetadataPatch('person', { role: 'Lead', badge: 'VIP' })).toEqual({
      ok: true,
      patch: { role: 'Lead', badge: 'VIP' },
    });
  });

  it('rejects reserved and contact metadata keys', () => {
    expect(parseObjectMetadataPatch('company', { fixture_version: 'x' })).toEqual({
      ok: false,
      error: 'Metadata field “Fixture version” is reserved',
    });
    expect(parseObjectMetadataPatch('person', { email: 'a@b.example' })).toEqual({
      ok: false,
      error: 'Use Contact for Email, not Details',
    });
    expect(parseObjectMetadataPatch('task', { provider: 'linear' })).toEqual({
      ok: false,
      error: 'Metadata field “Provider” is reserved',
    });
  });

  it('hides internal and contact keys from readable metadata entries', () => {
    expect(
      readableMetadataEntries('person', {
        role: 'Customer lead',
        email: 'elena@example.com',
        display_title: 'hidden',
        fixture_version: 'demo-seed-v1',
        provider: 'linear',
        note: 'Preferred contact via Slack',
      }),
    ).toEqual([
      { key: 'role', value: 'Customer lead' },
      { key: 'note', value: 'Preferred contact via Slack' },
    ]);
  });
});
