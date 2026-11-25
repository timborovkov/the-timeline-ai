import type { chatStructured } from '@timeline/shared/llm';

/** Explicit pass-through checker fixture for downstream pipeline tests, not a semantic checker.
 * Checker behavior and failure handling have separate controlled tests. Never used by live evals.
 */
export function controlledCommunicationAuditForSource(rawEventId?: string): typeof chatStructured {
  return (input) => {
    const marker = '\nDRAFT_PROPOSALS_JSON\n';
    const start = input.prompt.lastIndexOf(marker) + marker.length;
    const end = input.prompt.lastIndexOf('\nEND_DRAFT_PROPOSALS_JSON');
    const bundles = JSON.parse(input.prompt.slice(start, end)) as {
      items: { grounding?: unknown[] }[];
    }[];
    for (const bundle of bundles) for (const item of bundle.items) item.grounding ??= [];
    const sources = [
      ...input.prompt
        .slice(0, start - marker.length)
        .matchAll(/<external_content[^>]*event_id="([^"]+)"[^>]*>([\s\S]*?)<\/external_content>/g),
    ];
    const evidence = rawEventId
      ? sources.filter((source) => source[1] === rawEventId).at(-1)
      : sources.at(-1);
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
    const object = {
      removedDrafts: [],
      bundles: bundles.map((bundle) => ({
        ...bundle,
        items: bundle.items.map((item) => ({ ...item, coverage })),
      })),
      coverage:
        bundles.length || candidates.length
          ? []
          : [{ ...coverage, disposition: 'no_action', existingIds: [] }],
      pendingAmendments: candidates.map((candidate) => ({ id: candidate.id, coverage })),
    };
    return Promise.resolve({
      object: input.schema.parse(input.normalizeOutput ? input.normalizeOutput(object) : object),
      model: 'controlled-audit',
    });
  };
}

export const controlledCommunicationAudit = controlledCommunicationAuditForSource();
