import { z } from 'zod';

export const suggestionRejectionReason = z.enum([
  'duplicate',
  'already_resolved',
  'wrong_owner',
  'insufficient_evidence',
]);

export type SuggestionRejectionReason = z.infer<typeof suggestionRejectionReason>;

export const suggestionRejectionLabels: Record<SuggestionRejectionReason, string> = {
  duplicate: 'Duplicate',
  already_resolved: 'Already resolved',
  wrong_owner: 'Wrong owner',
  insufficient_evidence: 'Insufficient evidence',
};
