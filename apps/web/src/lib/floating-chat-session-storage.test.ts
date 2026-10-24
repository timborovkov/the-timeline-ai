// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from 'vitest';

import {
  clearAllFloatingChatSessionIds,
  pruneFloatingChatSessionIds,
  readFloatingChatSessionId,
  storeFloatingChatSessionId,
} from '@/lib/floating-chat-session-storage';

const NOW = Date.parse('2026-08-21T12:00:00.000Z');
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const TEAM_ONE = 'team-1';
const TEAM_TWO = 'team-2';
const SESSION_ONE = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const SESSION_TWO = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';

function storageKey(teamId: string): string {
  return `timeline:floating-agent-chat:${teamId}:session`;
}

afterEach(() => {
  window.localStorage.clear();
});

describe('floating chat session storage', () => {
  it('retains only a validated session id for seven days', () => {
    expect(storeFloatingChatSessionId(window.localStorage, TEAM_ONE, SESSION_ONE, NOW)).toBe(true);
    expect(readFloatingChatSessionId(window.localStorage, TEAM_ONE, NOW)).toBe(SESSION_ONE);
    expect(readFloatingChatSessionId(window.localStorage, TEAM_ONE, NOW + MAX_AGE_MS - 1)).toBe(
      SESSION_ONE,
    );
  });

  it('removes expired, legacy, malformed, and overlong records', () => {
    const key = storageKey(TEAM_ONE);
    storeFloatingChatSessionId(window.localStorage, TEAM_ONE, SESSION_ONE, NOW);
    expect(readFloatingChatSessionId(window.localStorage, TEAM_ONE, NOW + MAX_AGE_MS)).toBeNull();
    expect(window.localStorage.getItem(key)).toBeNull();

    for (const value of [
      SESSION_ONE,
      '{bad json',
      JSON.stringify({
        version: 1,
        sessionId: SESSION_ONE,
        expiresAt: NOW + MAX_AGE_MS + 1,
      }),
    ]) {
      window.localStorage.setItem(key, value);
      expect(readFloatingChatSessionId(window.localStorage, TEAM_ONE, NOW)).toBeNull();
      expect(window.localStorage.getItem(key)).toBeNull();
    }
  });

  it('prunes expired team entries and clears every floating session on sign-out', () => {
    storeFloatingChatSessionId(window.localStorage, TEAM_ONE, SESSION_ONE, NOW);
    storeFloatingChatSessionId(window.localStorage, TEAM_TWO, SESSION_TWO, NOW + 1);
    window.localStorage.setItem('unrelated-preference', 'keep');

    pruneFloatingChatSessionIds(window.localStorage, NOW + MAX_AGE_MS);

    expect(window.localStorage.getItem(storageKey(TEAM_ONE))).toBeNull();
    expect(readFloatingChatSessionId(window.localStorage, TEAM_TWO, NOW + 1)).toBe(SESSION_TWO);

    clearAllFloatingChatSessionIds(window.localStorage);

    expect(window.localStorage.getItem(storageKey(TEAM_TWO))).toBeNull();
    expect(window.localStorage.getItem('unrelated-preference')).toBe('keep');
  });

  it('refuses to persist an invalid server session id', () => {
    expect(storeFloatingChatSessionId(window.localStorage, TEAM_ONE, 'not-a-uuid', NOW)).toBe(
      false,
    );
    expect(window.localStorage.getItem(storageKey(TEAM_ONE))).toBeNull();
  });
});
