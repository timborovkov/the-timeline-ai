import type * as suggestionTypes from '@timeline/shared/suggestions';

type SuggestionBundle = suggestionTypes.SuggestionBundle;

interface SerializableSuggestionBundle {
  id: string;
  source: SuggestionBundle['source'];
  status: SuggestionBundle['status'];
  title: string;
  summary: string | null;
  reason: string | null;
  confidence: string;
  createdAt: string;
  items: SuggestionBundle['items'];
  evidence: {
    rawEventId: string;
    quote: string | null;
    source: string | null;
    occurredAt: string | null;
  }[];
}

export function serializeSuggestionBundle(bundle: SuggestionBundle): SerializableSuggestionBundle {
  return {
    id: bundle.id,
    source: bundle.source,
    status: bundle.status,
    title: bundle.title,
    summary: bundle.summary,
    reason: bundle.reason,
    confidence: bundle.confidence,
    createdAt: bundle.createdAt.toISOString(),
    items: bundle.items,
    evidence: bundle.evidence.map((ev) => ({
      rawEventId: ev.rawEventId,
      quote: ev.quote,
      source: ev.source,
      occurredAt: ev.occurredAt?.toISOString() ?? null,
    })),
  };
}
