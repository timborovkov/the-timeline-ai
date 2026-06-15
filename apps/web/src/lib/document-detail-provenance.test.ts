import { describe, expect, it } from 'vitest';

import { documentDetailProvenance } from '@/lib/document-detail-provenance';

describe('documentDetailProvenance', () => {
  it('preserves captured source event links when joined provenance is unavailable', () => {
    expect(
      documentDetailProvenance(
        {
          fileKind: 'captured',
          metadata: { source: 'telegram' },
          sourceRawEventId: '11111111-1111-4111-8111-111111111111',
        },
        null,
      ),
    ).toEqual({
      source: 'telegram',
      sourceEventId: '11111111-1111-4111-8111-111111111111',
      parentEventId: null,
      occurredAt: null,
      summary: null,
    });
  });

  it('prefers visible joined provenance when available', () => {
    const occurredAt = new Date('2026-06-15T09:30:00.000Z');

    expect(
      documentDetailProvenance(
        {
          fileKind: 'captured',
          metadata: { source: 'telegram' },
          sourceRawEventId: '11111111-1111-4111-8111-111111111111',
        },
        {
          provenance: {
            source: 'slack',
            sourceEventId: '22222222-2222-4222-8222-222222222222',
            parentEventId: '33333333-3333-4333-8333-333333333333',
            occurredAt,
            summary: 'Visible upload event',
          },
        },
      ),
    ).toEqual({
      source: 'slack',
      sourceEventId: '22222222-2222-4222-8222-222222222222',
      parentEventId: '33333333-3333-4333-8333-333333333333',
      occurredAt: '2026-06-15T09:30:00.000Z',
      summary: 'Visible upload event',
    });
  });

  it('keeps manual provenance for documents without captured source ids', () => {
    expect(
      documentDetailProvenance(
        {
          fileKind: 'document',
          metadata: {},
          sourceRawEventId: null,
        },
        null,
      ),
    ).toEqual({
      source: 'manual',
      sourceEventId: null,
      parentEventId: null,
      occurredAt: null,
      summary: null,
    });
  });
});
