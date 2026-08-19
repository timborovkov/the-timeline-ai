import { describe, expect, it } from 'vitest';

import {
  canonicalProposalPayloadIssues,
  normalizeProposalPayload,
} from '#src/suggestions/proposal-payload.js';

describe('normalizeProposalPayload', () => {
  it('moves non-UUID assignment ids onto name fields', () => {
    expect(
      normalizeProposalPayload({
        targetKind: 'task',
        operation: 'create',
        proposedPayload: {
          canonicalName: 'Fix worksheet',
          assigneeUserId: 'Mikael',
          ownerUserId: 'owner@example.test',
        },
      }),
    ).toEqual({
      canonicalName: 'Fix worksheet',
      assigneeName: 'Mikael',
      ownerName: 'owner@example.test',
    });
  });

  it('copies startsAt/endsAt onto canonical calendar instants', () => {
    expect(
      normalizeProposalPayload({
        targetKind: 'calendar_event',
        operation: 'create',
        title: 'Padel with Mikael',
        proposedPayload: {
          title: 'Padel with Mikael',
          startsAt: '2026-08-18T00:00:00.000Z',
          endsAt: '2026-08-19T00:00:00.000Z',
        },
      }),
    ).toMatchObject({
      startAt: '2026-08-18T00:00:00.000Z',
      endAt: '2026-08-19T00:00:00.000Z',
    });
  });

  it('promotes date-only calendar bounds onto startDate/endDate', () => {
    expect(
      normalizeProposalPayload({
        targetKind: 'calendar_event',
        operation: 'create',
        proposedPayload: {
          start: '2026-08-18',
          end: '2026-08-19',
        },
      }),
    ).toMatchObject({
      startDate: '2026-08-18',
      endDate: '2026-08-19',
    });
  });

  it('collapses duplicate relationship endpoints and aliases kind', () => {
    const payload = normalizeProposalPayload({
      targetKind: 'object_relationship',
      operation: 'create',
      proposedPayload: {
        fromEntityId: '11111111-1111-4111-8111-111111111111',
        fromName: 'Acme Labs',
        to: 'AuditAI',
        kind: 'associated_with',
      },
    });
    expect(payload).toEqual({
      fromEntityId: '11111111-1111-4111-8111-111111111111',
      toName: 'AuditAI',
      kind: 'related',
    });
    expect(
      canonicalProposalPayloadIssues({
        targetKind: 'object_relationship',
        operation: 'create',
        proposedPayload: payload,
      }),
    ).toEqual([]);
  });

  it('treats a slug stuffed into fromEntityId as a local ref', () => {
    expect(
      normalizeProposalPayload({
        targetKind: 'object_relationship',
        operation: 'create',
        proposedPayload: {
          fromEntityId: 'fix-worksheet',
          toName: 'AuditAI',
          kind: 'works_on',
        },
      }),
    ).toEqual({
      fromRef: 'fix-worksheet',
      toName: 'AuditAI',
      kind: 'related',
    });
  });
});
