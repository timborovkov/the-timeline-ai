import { describe, expect, it } from 'vitest';

import { chatErrorMessage, searchErrorMessage } from '@/lib/ux-errors';

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
});
