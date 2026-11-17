import { requireValue } from '@timeline/shared/evals/benchmark';
import { expect, test } from 'bun:test';

import {
  validateCommunicationCoverage,
  communicationCoverageQuotes,
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
        items: [{ grounding: [{ quote }], coverage: { evidence: [{ rawEventId: event, quote }] } }],
      },
    ],
    coverage: [{ evidence: [{ quote: 'fabricated' }] }],
    pendingAmendments: [{ coverage: { evidence: [{ quote: 'quote-0' }] } }],
  };
  const normalized = referenceCommunicationCoverageQuotes(input, [quote]);
  expect(normalized).toEqual({
    bundles: [
      {
        items: [
          {
            grounding: [{ quote: 'quote-0' }],
            coverage: { evidence: [{ rawEventId: event, quote: 'quote-0' }] },
          },
        ],
      },
    ],
    coverage: [{ evidence: [{ quote: 'fabricated' }] }],
    pendingAmendments: [{ coverage: { evidence: [{ quote: 'quote-0' }] } }],
  });
  expect(input.bundles[0]?.items[0]?.coverage.evidence[0]?.quote).toBe(quote);
});

test('quote references remain idempotent when source text resembles a reference', () => {
  const quotes = ['Publish the guide.', 'quote-0', 'quote-1'];
  const input = { coverage: [{ evidence: [{ quote: 'quote-0' }] }] };
  const once = referenceCommunicationCoverageQuotes(input, quotes);
  expect(once).toEqual(input);
  expect(referenceCommunicationCoverageQuotes(once, quotes)).toEqual(input);
});
