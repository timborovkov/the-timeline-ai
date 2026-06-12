const ACTIONABLE_SUGGESTION_STATUSES = new Set(['pending', 'failed']);

export function isActionableSuggestionStatus(status: string): boolean {
  return ACTIONABLE_SUGGESTION_STATUSES.has(status);
}
