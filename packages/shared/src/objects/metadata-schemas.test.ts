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

  it('rejects metadata patches for unsupported object types', () => {
    expect(parseObjectMetadataPatch('project', { domain: 'x.example' })).toEqual({
      ok: false,
      error: 'Metadata editing is not supported for project objects',
    });
  });

  it('returns readable metadata entries for known and legacy keys', () => {
    expect(
      readableMetadataEntries('person', {
        role: 'Customer lead',
        email: 'elena@example.com',
        display_title: 'hidden',
      }),
    ).toEqual([
      { key: 'role', value: 'Customer lead' },
      { key: 'email', value: 'elena@example.com' },
    ]);
  });
});
