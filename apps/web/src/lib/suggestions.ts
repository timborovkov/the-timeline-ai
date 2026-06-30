import type * as suggestionTypes from '@timeline/shared/suggestions';

type SuggestionBundle = suggestionTypes.SuggestionBundle;

interface SerializableCalendarResolutionEvent {
  id: string;
  title: string;
  description: string | null;
  startAt: string;
  endAt: string;
  timezone: string;
  allDay: boolean;
  location: string | null;
  showAs: string;
  visibility: string;
  rrule: string | null;
}

type SerializableCalendarResolutionHint =
  | { kind: 'new_event' }
  | { kind: 'exact_duplicate_reuse'; event: SerializableCalendarResolutionEvent }
  | { kind: 'semantic_update_candidate'; event: SerializableCalendarResolutionEvent }
  | { kind: 'ambiguous_match'; events: SerializableCalendarResolutionEvent[] }
  | { kind: 'target_event'; event: SerializableCalendarResolutionEvent }
  | { kind: 'missing_target' };

type SerializableSuggestionItem = Omit<
  SuggestionBundle['items'][number],
  'calendarResolutionHint'
> & {
  calendarResolutionHint?: SerializableCalendarResolutionHint | null;
};

interface SerializableSuggestionBundle {
  id: string;
  source: SuggestionBundle['source'];
  status: SuggestionBundle['status'];
  title: string;
  summary: string | null;
  reason: string | null;
  confidence: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  items: SerializableSuggestionItem[];
  evidence: {
    rawEventId: string;
    quote: string | null;
    source: string | null;
    occurredAt: string | null;
    metadata: Record<string, unknown>;
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
    metadata: bundle.metadata,
    createdAt: bundle.createdAt.toISOString(),
    items: bundle.items.map((item) => ({
      ...item,
      calendarResolutionHint: serializeCalendarResolutionHint(item.calendarResolutionHint),
    })),
    evidence: bundle.evidence.map((ev) => ({
      rawEventId: ev.rawEventId,
      quote: ev.quote,
      source: ev.source,
      occurredAt: ev.occurredAt?.toISOString() ?? null,
      metadata: ev.metadata,
    })),
  };
}

function serializeCalendarResolutionHint(
  hint: suggestionTypes.CalendarResolutionHint | null | undefined,
): SerializableSuggestionItem['calendarResolutionHint'] {
  if (!hint) return hint;
  if (hint.kind === 'exact_duplicate_reuse' || hint.kind === 'semantic_update_candidate') {
    return { ...hint, event: serializeCalendarResolutionEvent(hint.event) };
  }
  if (hint.kind === 'ambiguous_match') {
    return { ...hint, events: hint.events.map(serializeCalendarResolutionEvent) };
  }
  if (hint.kind === 'target_event') {
    return { ...hint, event: serializeCalendarResolutionEvent(hint.event) };
  }
  return hint;
}

function serializeCalendarResolutionEvent(
  event: suggestionTypes.CalendarResolutionEventSummary,
): SerializableCalendarResolutionEvent {
  return {
    ...event,
    startAt: event.startAt.toISOString(),
    endAt: event.endAt.toISOString(),
  };
}
