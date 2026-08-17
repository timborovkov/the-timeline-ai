import { describe, expect, it } from 'vitest';

import { chatSessionLabel, filterChatSessions } from '@/lib/chat-session-list';

const sessions = [
  {
    title: 'Website requirements and launch',
    pinnedEntityName: null,
  },
  {
    title: null,
    pinnedEntityName: 'Acme renewal',
  },
  {
    title: 'Last week recap',
    pinnedEntityName: null,
  },
];

describe('chatSessionLabel', () => {
  it('prefers the stored title and falls back to a pinned object or untitled chat', () => {
    expect(chatSessionLabel({ title: 'Launch review', pinnedEntityName: 'Acme' })).toBe(
      'Launch review',
    );
    expect(chatSessionLabel({ title: null, pinnedEntityName: 'Acme renewal' })).toBe(
      'Chat about Acme renewal',
    );
    expect(chatSessionLabel({ title: null, pinnedEntityName: null })).toBe('Untitled chat');
  });
});

describe('filterChatSessions', () => {
  it('filters by title or pinned object without requiring an exact match', () => {
    expect(filterChatSessions(sessions, '  REQUIREMENTS ')).toEqual([sessions[0]]);
    expect(filterChatSessions(sessions, 'renewal')).toEqual([sessions[1]]);
    expect(filterChatSessions(sessions, 'recap')).toEqual([sessions[2]]);
  });

  it('returns the original list when the query is blank', () => {
    expect(filterChatSessions(sessions, '   ')).toBe(sessions);
  });
});
