import { requireValue } from '@timeline/shared/evals/benchmark';
import { attachUniqueHubsToBundles, qualifyWorkspaceHubs } from '@timeline/shared/suggestions';
import { expect, test } from 'bun:test';
import { z } from 'zod';

import {
  validateCommunicationCoverage,
  communicationCoverageSchema,
  communicationCoverageQuotes,
  communicationCitationVariants,
  communicationDraftAccountingErrors,
  referenceCommunicationCoverageQuotes,
  assertCommunicationClaimsRetained,
  type CommunicationCoverage,
} from '#src/workers/communication-audit.js';
const event = '11111111-1111-4111-8111-111111111111';
const quote = 'Please prepare the release checklist.';
const coverage: CommunicationCoverage = [
  {
    kind: 'task',
    disposition: 'proposed',
    evidence: [{ rawEventId: event, quote }],
    proposalIds: ['task'],
    existingIds: [],
    reason: 'Explicit request.',
  },
];
const bundles = [{ items: [{ auditId: 'task', proposedPayload: {} }] }];
const args = {
  coverage,
  bundles,
  packet: quote,
  sources: [{ id: event, text: quote }],
  existingIds: [],
};
test('coverage requires actual visible source evidence and matching proposals', () => {
  expect(() => {
    validateCommunicationCoverage(args);
  }).not.toThrow();
  for (const patch of [
    { packet: '' },
    { sources: [] },
    { bundles: [] },
    { bundles: [...bundles, ...bundles] },
  ])
    expect(() => {
      validateCommunicationCoverage({ ...args, ...patch });
    }).toThrow();
});
test('no action must explain itself without referring to proposals', () => {
  expect(() => {
    validateCommunicationCoverage({
      ...args,
      bundles: [],
      coverage: [
        {
          ...requireValue(coverage[0]),
          disposition: 'no_action',
          proposalIds: [],
          reason: 'Hypothetical request only.',
        },
      ],
    });
  }).not.toThrow();
  expect(() => {
    validateCommunicationCoverage({
      ...args,
      coverage: [{ ...requireValue(coverage[0]), disposition: 'no_action' }],
    });
  }).toThrow();
});
test('existing disposition cannot reference an unavailable record', () => {
  expect(() => {
    validateCommunicationCoverage({
      ...args,
      bundles: [],
      coverage: [
        {
          ...requireValue(coverage[0]),
          disposition: 'existing',
          proposalIds: [],
          existingIds: [event],
        },
      ],
    });
  }).toThrow();
});
test('checked field or item removal fails the whole attempt', () => {
  const original = [
    { items: [{ auditId: 'task', proposedPayload: { status: 'done', assigneeUserId: null } }] },
  ];
  expect(() => {
    assertCommunicationClaimsRetained(original, original);
  }).not.toThrow();
  expect(() => {
    assertCommunicationClaimsRetained(original, bundles);
  }).toThrow();
  expect(() => {
    assertCommunicationClaimsRetained(original, []);
  }).toThrow();
});

test('no-action may preserve a known object but cannot invent one', () => {
  const preserved = {
    ...args,
    bundles: [],
    existingIds: [event],
    coverage: [
      {
        ...requireValue(coverage[0]),
        disposition: 'no_action' as const,
        proposalIds: [],
        existingIds: [event],
      },
    ],
  };
  expect(() => {
    validateCommunicationCoverage(preserved);
  }).not.toThrow();
  expect(() => {
    validateCommunicationCoverage({ ...preserved, existingIds: [] });
  }).toThrow();
});

test('coverage quote choices contain only literal visible source excerpts', () => {
  const text = 'Credentials arrived. We have resumed working on Publish integration guide.';
  const choices = communicationCoverageQuotes({
    sources: [{ id: event, text }],
    packet: text,
    draftQuotes: ['Credentials arrived.', 'Product approved the guide.'],
  });
  expect(choices).toContain(text);
  expect(choices).toContain('Credentials arrived.');
  expect(choices).not.toContain('Product approved the guide.');
  expect(choices.every((choice) => text.includes(choice))).toBe(true);
  expect(new Set(choices).size).toBe(choices.length);
  expect(
    communicationCoverageQuotes({
      sources: [{ id: event, text }],
      packet: 'Credentials arrived.',
      draftQuotes: [],
    }),
  ).toEqual(['Credentials arrived.']);
  expect(
    communicationCoverageQuotes({ sources: [{ id: event, text }], packet: '', draftQuotes: [] }),
  ).toEqual([]);
});

test('long source excerpt choices stay bounded and exclude truncated evidence', () => {
  const first = 'a'.repeat(1200);
  const hidden = 'Private evidence beyond the packet.';
  const choices = communicationCoverageQuotes({
    sources: [{ id: event, text: first + '\n' + hidden }],
    packet: first,
    draftQuotes: [hidden],
  });
  expect(choices.length).toBeGreaterThan(0);
  expect(choices.every((choice) => choice.length <= 1000 && first.includes(choice))).toBe(true);
});

test('audit references normalize only valid literals in coverage and grounding', () => {
  const input = {
    bundles: [
      {
        items: [
          {
            grounding: [{ rawEventId: event, quote }],
            coverage: { evidence: [{ rawEventId: event, quote }] },
          },
        ],
      },
    ],
    coverage: [{ evidence: [{ quote: 'fabricated' }] }],
    pendingAmendments: [{ coverage: { evidence: [{ quote: 'quote-0' }] } }],
    rejectedAmendments: [{ coverage: { evidence: [{ rawEventId: event, quote }] } }],
  };
  const normalized = referenceCommunicationCoverageQuotes(input, [quote]);
  expect(normalized).toEqual({
    bundles: [
      {
        items: [
          {
            grounding: [{ citation: { rawEventId: event, quote: 'quote-0' } }],
            coverage: { evidence: [{ rawEventId: event, quote: 'quote-0' }] },
          },
        ],
      },
    ],
    coverage: [{ evidence: [{ quote: 'fabricated' }] }],
    pendingAmendments: [{ coverage: { evidence: [{ quote: 'quote-0' }] } }],
    rejectedAmendments: [{ coverage: { evidence: [{ rawEventId: event, quote: 'quote-0' }] } }],
  });
  expect(input.bundles[0]?.items[0]?.coverage.evidence[0]?.quote).toBe(quote);
  expect(referenceCommunicationCoverageQuotes(normalized, [quote])).toEqual(normalized);
});

test('quote references remain idempotent when source text resembles a reference', () => {
  const quotes = ['Publish the guide.', 'quote-0', 'quote-1'];
  const input = { coverage: [{ evidence: [{ quote: 'quote-0' }] }] };
  const once = referenceCommunicationCoverageQuotes(input, quotes);
  expect(once).toEqual(input);
  expect(referenceCommunicationCoverageQuotes(once, quotes)).toEqual(input);
});

test('generation schema binds quote references to their actual event sources', () => {
  const other = '22222222-2222-4222-8222-222222222222';
  const quotes = ['Please prepare the checklist.', 'Cancel the checklist.', 'Shared context.'];
  const schema = z.discriminatedUnion(
    'rawEventId',
    communicationCitationVariants(quotes, [
      { id: event, text: 'Please prepare the checklist. Shared context.' },
      { id: other, text: 'Cancel the checklist. Shared context.' },
      { id: event, text: 'Please prepare the checklist. Shared context.' },
      { id: other, text: 'Extra duplicate snapshot must not expand the validator snapshot.' },
    ]),
  );
  expect(schema.safeParse({ rawEventId: event, quote: 'quote-0' }).success).toBe(true);
  expect(schema.safeParse({ rawEventId: other, quote: 'quote-1' }).success).toBe(true);
  expect(schema.safeParse({ rawEventId: event, quote: 'quote-1' }).success).toBe(false);
  expect(schema.safeParse({ rawEventId: other, quote: 'quote-0' }).success).toBe(false);
  for (const id of [event, other])
    expect(schema.safeParse({ rawEventId: id, quote: 'quote-2' }).success).toBe(true);
  expect(schema.safeParse({ rawEventId: event, quote: 'quote-99' }).success).toBe(false);
});

test('draft accounting requires explicit retention or rejection without conflating work', () => {
  const item = {
    operation: 'create',
    targetKind: 'task',
    proposedPayload: { canonicalName: 'Prepare deployment checklist' },
  };
  const draft = { id: 'draft-0-0', item };
  const retained = { ...item, sourceDraftId: draft.id };
  const check = (
    items: (typeof item & { sourceDraftId?: string | null })[],
    removedDrafts: { id: string }[] = [],
    drafts = [draft],
  ) => communicationDraftAccountingErrors({ drafts, bundles: [{ items }], removedDrafts });
  expect(check([retained])).toEqual([]);
  expect(check([], [{ id: draft.id }])).toEqual([]);
  expect(check([retained, { ...item, sourceDraftId: null }])).toEqual([]);
  expect(
    check(
      [
        {
          ...item,
          targetKind: 'object',
          proposedPayload: { canonicalName: 'Customer' },
          sourceDraftId: null,
        },
      ],
      [{ id: draft.id }],
    ),
  ).toEqual([]);
  expect(check([]).length).toBeGreaterThan(0);
  expect(check([retained, retained]).length).toBeGreaterThan(0);
  expect(check([retained], [{ id: draft.id }]).length).toBeGreaterThan(0);
  expect(check([{ ...retained, sourceDraftId: 'invented' }]).length).toBeGreaterThan(0);
  expect(check([{ ...retained, targetKind: 'object' }]).length).toBeGreaterThan(0);
  expect(check([retained], [], [draft, { id: 'draft-0-1', item }]).length).toBeGreaterThan(0);
});

test('ambiguous draft fragments cannot replace their complete source clauses', () => {
  const text =
    'For our client Cedar, we are planning a Patient Portal project. Link Patient Portal to Cedar.';
  const choices = communicationCoverageQuotes({
    sources: [{ id: event, text }],
    packet: text,
    draftQuotes: ['Cedar', 'Patient Portal', 'our client Cedar'],
  });
  expect(choices).not.toContain('Cedar');
  expect(choices).not.toContain('Patient Portal');
  expect(choices).toContain('our client Cedar');
  expect(choices).toContain('For our client Cedar, we are planning a Patient Portal project.');
  expect(choices).toContain('Link Patient Portal to Cedar.');
  expect(choices).toContain(text);
});

test('generated vendor relationships preserve the audited task identity', () => {
  const before = [
    {
      items: [
        {
          auditId: 'checked-task',
          operation: 'create',
          targetKind: 'task',
          title: 'Review print proofs',
          proposedPayload: { assigneeUserId: event, dueAt: '2026-06-12T09:00:00Z', status: 'todo' },
        },
      ],
    },
  ];
  const after = attachUniqueHubsToBundles({
    bundles: before,
    qualified: qualifyWorkspaceHubs({
      hubs: [{ id: 'vendor', name: 'Printworks', type: 'vendor', aliases: [], status: 'active' }],
      text: 'Review print proofs for Printworks.',
    }),
  });
  expect(after[0]?.items).toHaveLength(2);
  expect(after[0]?.items[0]?.auditId).toBe('checked-task');
  expect(after[0]?.items[1]?.auditId).toBeUndefined();
  expect(() => {
    assertCommunicationClaimsRetained(before, after);
  }).not.toThrow();
});

test('short literal acknowledgments can receive no-action coverage', () => {
  for (const text of ['ok', '👍', 'k']) {
    const sources = [{ id: event, text }];
    expect(communicationCoverageQuotes({ sources, packet: text, draftQuotes: [] })).toEqual([text]);
    const shortCoverage = communicationCoverageSchema.parse([
      {
        ...coverage[0],
        disposition: 'no_action',
        proposalIds: [],
        evidence: [{ rawEventId: event, quote: text }],
      },
    ]);
    expect(() => {
      validateCommunicationCoverage({
        ...args,
        coverage: shortCoverage,
        bundles: [],
        sources,
        packet: text,
      });
    }).not.toThrow();
    expect(communicationCoverageQuotes({ sources, packet: '', draftQuotes: [] })).toEqual([]);
  }
  expect(
    communicationCoverageQuotes({
      sources: [{ id: event, text: ' ' }],
      packet: ' ',
      draftQuotes: [],
    }),
  ).toEqual([]);
});
