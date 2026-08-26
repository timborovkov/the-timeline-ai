import type { ConversationDeliveryAdapter } from '#src/conversation-surfaces/types.js';

export const OBJECT_DISCUSSION_SURFACE = 'object_discussion';
const OBJECT_DISCUSSION_KEY_RE =
  /^object:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

export function parseObjectDiscussionKey(externalConversationKey: string): string | null {
  const match = OBJECT_DISCUSSION_KEY_RE.exec(externalConversationKey);
  return match?.[1] ?? null;
}

export function createObjectDiscussionDeliveryAdapter(input: {
  postComment: (text: string) => Promise<void>;
}): ConversationDeliveryAdapter {
  return {
    acknowledgeAgentRequest: () => Promise.resolve(),
    acknowledgeCapture: () => Promise.resolve(),
    startProgress: async () => {
      await input.postComment('_Looking that up…_');
      return () => undefined;
    },
    deliverAnswer: (text) => input.postComment(text),
    deliverFailure: (text) => input.postComment(text),
  };
}
