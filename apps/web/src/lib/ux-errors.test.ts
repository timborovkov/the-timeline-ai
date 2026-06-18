import { describe, expect, it } from 'vitest';

import { chatErrorMessage, connectionErrorMessage, searchErrorMessage } from '@/lib/ux-errors';

describe('UX error messages', () => {
  it('maps search configuration failures to human recovery copy', () => {
    expect(searchErrorMessage('search_unconfigured')).toContain('Search is not configured yet');
    expect(searchErrorMessage('search_failed')).toContain('temporarily unavailable');
    expect(searchErrorMessage('rate_limited')).toContain('cooling down');
  });

  it('maps chat API failures without leaking raw JSON codes', () => {
    expect(chatErrorMessage('chat_unconfigured')).toContain('Chat needs OpenRouter and Qdrant');
    expect(chatErrorMessage('session_not_found')).toContain('Start a new chat');
    expect(chatErrorMessage(undefined, 503)).toBe('Chat failed (503).');
  });

  it('maps connection failures to human recovery copy with an action path', () => {
    expect(connectionErrorMessage('forbidden')).toContain('Ask a team admin');
    expect(connectionErrorMessage('oauth_start_failed')).toContain('try again');
    expect(connectionErrorMessage('not_found')).toContain('no longer exists');
    expect(connectionErrorMessage(undefined, 500)).toBe('Connection failed (500).');
  });
});
