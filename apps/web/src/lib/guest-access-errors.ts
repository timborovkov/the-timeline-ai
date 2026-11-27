import { redactConversationError } from '@timeline/shared/conversation-surfaces';
import { DrizzleQueryError } from 'drizzle-orm/errors';

export async function withGuestErrorRedaction<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof DrizzleQueryError) throw redactConversationError(error);
    throw error;
  }
}
