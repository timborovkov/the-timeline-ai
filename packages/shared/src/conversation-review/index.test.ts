import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';

import {
  CONVERSATION_WINDOW_DAYS,
  CONVERSATION_WINDOW_LIMIT,
  LINKED_CONTEXT_LIMIT,
} from '#src/conversation-review/index.js';
describe('conversation review window caps', () => {
  it('keeps suggestion context windows lean', () => {
    expect(CONVERSATION_WINDOW_DAYS).toBe(2);
    expect(CONVERSATION_WINDOW_LIMIT).toBe(24);
    expect(LINKED_CONTEXT_LIMIT).toBe(8);
  });
});
