import type { chatStructured } from '@timeline/shared/llm';

/** Explicit pass-through checker fixture for downstream pipeline tests, not a semantic checker.
 * Checker behavior and failure handling have separate controlled tests. Never used by live evals.
 */
export const controlledCommunicationAudit: typeof chatStructured = (input) => {
  const marker = '\nDRAFT_PROPOSALS_JSON\n';
  const start = input.prompt.lastIndexOf(marker) + marker.length;
  const end = input.prompt.lastIndexOf('\nEND_DRAFT_PROPOSALS_JSON');
  const bundles = JSON.parse(input.prompt.slice(start, end)) as {
    items: { auditId: string; grounding?: unknown[] }[];
  }[];
  for (const bundle of bundles) for (const item of bundle.items) item.grounding ??= [];
  const evidence = [
    ...input.prompt
      .slice(0, start - marker.length)
      .matchAll(/<external_content[^>]*event_id="([^"]+)"[^>]*>([\s\S]*?)<\/external_content>/g),
  ].at(-1);
  if (!evidence?.[1] || !evidence[2]?.trim()) throw new Error('Missing controlled audit source');
  const pendingMarker = '\nPENDING_AMENDMENTS_JSON\n';
  const candidates = JSON.parse(
    input.prompt.slice(
      input.prompt.lastIndexOf(pendingMarker) + pendingMarker.length,
      input.prompt.lastIndexOf('\nEND_PENDING_AMENDMENTS_JSON'),
    ),
  ) as { id: string }[];
  const proposalIds = bundles.flatMap((bundle) => bundle.items.map((item) => item.auditId));
  proposalIds.push(...candidates.map((candidate) => `pending-${candidate.id}`));
  const coverage = [
    {
      kind: 'other',
      disposition: proposalIds.length ? 'proposed' : 'no_action',
      evidence: [{ rawEventId: evidence[1], quote: evidence[2].trim().slice(0, 1000) }],
      proposalIds,
      existingIds: [],
      reason: 'Controlled checker output for a downstream pipeline test.',
    },
  ];
  return Promise.resolve({
    object: input.schema.parse({
      bundles,
      coverage,
      pendingAmendmentIds: candidates.map((candidate) => candidate.id),
    }),
    model: 'controlled-audit',
  }) as never;
};
