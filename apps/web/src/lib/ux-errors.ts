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
    case 'invalid_input':
      return 'Search could not read those filters. Clear them and try again.';
    case 'no_active_team':
      return 'Choose a team before searching.';
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

export function connectionErrorMessage(error: string | undefined, status?: number): string {
  if (
    error?.includes('github_rate_limited') ||
    error?.includes('API rate limit exceeded') ||
    error?.includes('secondary rate limit')
  ) {
    return 'GitHub is rate limiting this connection. Sync will resume automatically after the cooldown window.';
  }
  if (error?.includes('github_incremental_partial') || error?.includes('github_backfill_partial')) {
    if (error.includes('commits:page_cap')) {
      return 'GitHub has more commit history to catch up. Timeline saved the current checkpoint and the next sync will continue from there.';
    }
    if (error.includes('Pull requests read permission required')) {
      return 'GitHub needs pull request read access for one or more selected repos. Update the GitHub App permissions, then reconnect.';
    }
    if (error.includes('GitHub GET /repos/')) {
      return 'GitHub could not read one or more selected repos. Check that the connection still has access, then sync again.';
    }
    return 'GitHub synced partially. Some selected repos need attention before Timeline can finish syncing them.';
  }
  switch (error) {
    case 'unauthorized':
    case 'unauthenticated':
      return 'Sign in again to manage this connection.';
    case 'forbidden':
      return 'Only an admin can do this. Ask a team admin to help.';
    case 'not_found':
      return 'This connection no longer exists. Refresh the page to update the list.';
    case 'no_team':
      return 'Choose a team before connecting a source.';
    case 'unknown_provider':
      return 'This source is not supported yet.';
    case 'oauth_start_failed':
      return 'Could not start the connection. The provider may be temporarily unavailable — try again in a moment.';
    case 'no_active_team':
      return 'Choose a team before managing connections.';
    default:
      return error ?? `Connection failed${status ? ` (${String(status)})` : ''}.`;
  }
}
