import { describe, expect, it } from 'vitest';

import { redactConversationError } from '#src/conversation-surfaces/privacy.js';

describe('conversation error redaction', () => {
  it('does not expose Drizzle query parameters containing private conversation text', () => {
    const original = Object.assign(
      new Error(
        'Failed query: insert into chat_surface_turns(question_text) values ()\nparams: PRIVATE QUESTION',
      ),
      { code: '23505' },
    );

    const safe = redactConversationError(original);

    expect(safe).toMatchObject({
      name: 'Error',
      message: 'Conversation operation failed',
      code: '23505',
    });
    expect(JSON.stringify(safe)).not.toContain('PRIVATE QUESTION');
    expect(safe.stack).not.toContain('PRIVATE QUESTION');
  });
});
