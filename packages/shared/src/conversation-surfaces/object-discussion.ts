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
    // Discussion comments are durable. Do not post a progress note — the
    // runtime and worker both call startProgress, and there is no safe way
    // to delete an ephemeral note from this adapter.
    startProgress: () => Promise.resolve(() => undefined),
    deliverAnswer: (text) => input.postComment(text),
    deliverFailure: (text) => input.postComment(text),
  };
}
