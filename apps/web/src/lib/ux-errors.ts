export function searchErrorMessage(error: string | undefined, status?: number): string {
  switch (error) {
    case 'search_unconfigured':
      return 'Search is not configured yet. Captured events are saved, but semantic search needs OpenRouter and Qdrant before it can answer.';
    case 'search_failed':
    case 'embed_failed':
    case 'qdrant_failed':
      return 'Search is temporarily unavailable. Your timeline is still saved; try again after processing recovers.';
    case 'rate_limited':
      return 'Search is cooling down for this account. Wait a moment, then try again.';
    case 'unauthenticated':
      return 'Sign in again to search this timeline.';
    default:
      return error ?? `Search failed${status ? ` (${String(status)})` : ''}.`;
  }
}

export function chatErrorMessage(error: string | undefined, status?: number): string {
  switch (error) {
    case 'chat_unconfigured':
      return 'Chat needs OpenRouter and Qdrant before it can answer. Capture and timeline browsing still work.';
    case 'rate_limited':
      return 'Chat is cooling down for this account. Wait a moment, then try again.';
    case 'unauthenticated':
      return 'Sign in again to ask the timeline.';
    case 'session_not_found':
      return 'That chat session is no longer available. Start a new chat to continue.';
    case 'invalid_messages':
    case 'invalid_input':
      return 'Chat could not read that message. Try rephrasing and sending again.';
    default:
      return error ?? `Chat failed${status ? ` (${String(status)})` : ''}.`;
  }
}
