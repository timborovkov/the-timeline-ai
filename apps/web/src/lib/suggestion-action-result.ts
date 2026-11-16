import type { ActionState } from '@/lib/action-result';

export interface SuggestionActionState extends ActionState {
  failedItemIds?: string[];
  revisedItem?: {
    id: string;
    status: string;
    title: string;
    description: string | null;
    proposedPayload: Record<string, unknown>;
  };
}
