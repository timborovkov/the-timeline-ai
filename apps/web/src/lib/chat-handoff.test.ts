import { describe, expect, it } from 'vitest';

import {
  CHAT_HANDOFF_MAX_AGE_MS,
  chatHandoffKey,
  consumeChatHandoff,
  consumeChatHandoffEntry,
  storeChatHandoff,
  storeChatContextHandoff,
  validateChatHandoffPrompt,
} from '@/lib/chat-handoff';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    removeItem: (key: string) => values.delete(key),
    setItem: (key: string, value: string) => values.set(key, value),
    values,
  };
}

describe('chat handoff', () => {
  it('stores a trimmed team-scoped prompt and consumes it once', () => {
    const storage = memoryStorage();
    storeChatHandoff(storage, 'team-a', '  What changed?  ', 1_000);
    expect(storage.values.has(chatHandoffKey('team-a'))).toBe(true);
    expect(consumeChatHandoff(storage, 'team-a', 2_000)).toBe('What changed?');
    expect(consumeChatHandoff(storage, 'team-a', 2_000)).toBeNull();
  });

  it('deletes and rejects stale or malformed handoffs', () => {
    const storage = memoryStorage();
    storeChatHandoff(storage, 'team-a', 'Old prompt', 1_000);
    expect(consumeChatHandoff(storage, 'team-a', 1_000 + CHAT_HANDOFF_MAX_AGE_MS + 1)).toBeNull();
    expect(storage.values.has(chatHandoffKey('team-a'))).toBe(false);

    storage.setItem(chatHandoffKey('team-a'), '{bad json');
    expect(consumeChatHandoff(storage, 'team-a', 2_000)).toBeNull();
  });

  it('validates empty and oversized prompts', () => {
    expect(validateChatHandoffPrompt('   ')).toMatch(/Enter a question/);
    expect(validateChatHandoffPrompt('a'.repeat(4_001))).toMatch(/4,000/);
    expect(validateChatHandoffPrompt('What is blocked?')).toBeNull();
  });

  it('hands contextual Ask state off once without putting it in a URL', () => {
    const storage = memoryStorage();
    storeChatContextHandoff(
      storage,
      'team-a',
      {
        context: {
          pathname: '/app/objects/object-id',
          routeKind: 'object-detail',
          objectId: 'object-id',
        },
        pinnedEntityId: 'object-id',
        pinnedEntityName: 'Launch plan',
      },
      1_000,
    );
    expect(consumeChatHandoffEntry(storage, 'team-a', 2_000)).toMatchObject({
      context: { routeKind: 'object-detail', objectId: 'object-id' },
      pinnedEntityId: 'object-id',
      pinnedEntityName: 'Launch plan',
    });
    expect(consumeChatHandoffEntry(storage, 'team-a', 2_000)).toBeNull();
  });
});
