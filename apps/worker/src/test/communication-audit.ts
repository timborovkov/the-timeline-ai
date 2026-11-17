import type { chatStructured } from '@timeline/shared/llm';

/** Explicit pass-through checker fixture for downstream pipeline tests, not a semantic checker.
 * Checker behavior and failure handling have separate controlled tests. Never used by live evals.
 */
export const controlledCommunicationAudit: typeof chatStructured = (input) => {
  const marker = '\nDRAFT_PROPOSALS_JSON\n';
  const start = input.prompt.lastIndexOf(marker) + marker.length;
  const end = input.prompt.lastIndexOf('\nEND_DRAFT_PROPOSALS_JSON');
  const bundles = JSON.parse(input.prompt.slice(start, end)) as {
    items: { grounding?: unknown[] }[];
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
  const quoteMarker = '\nCOVERAGE_QUOTE_OPTIONS\n';
  const quoteOptions = JSON.parse(
    input.prompt
      .slice(
        input.prompt.lastIndexOf(quoteMarker) + quoteMarker.length,
        input.prompt.lastIndexOf('\nEND_COVERAGE_QUOTE_OPTIONS'),
      )
      .replace(/^<external_content[^>]*>/u, '')
      .replace(/<\/external_content>$/u, ''),
  ) as Record<string, string>;
  const quoteRef = Object.entries(quoteOptions).find(([, quote]) =>
    evidence[2]?.includes(quote),
  )?.[0];
  if (!quoteRef) throw new Error('Missing controlled audit quote reference');
  const coverage = {
    kind: 'other',
    evidence: [{ rawEventId: evidence[1], quote: quoteRef }],
    reason: 'Controlled checker output for a downstream pipeline test.',
  };
  return Promise.resolve({
    object: input.schema.parse({
      bundles: bundles.map((bundle) => ({
        ...bundle,
        items: bundle.items.map((item) => ({ ...item, coverage })),
      })),
      coverage:
        bundles.length || candidates.length
          ? []
          : [{ ...coverage, disposition: 'no_action', existingIds: [] }],
      pendingAmendments: candidates.map((candidate) => ({ id: candidate.id, coverage })),
    }),
    model: 'controlled-audit',
  });
};
