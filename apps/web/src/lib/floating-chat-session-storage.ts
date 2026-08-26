const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const FLOATING_CHAT_SESSION_STORAGE_PREFIX = 'timeline:floating-agent-chat:';
const FLOATING_CHAT_SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

interface StoredFloatingChatSession {
  version: 1;
  sessionId: string;
  expiresAt: number;
}

function floatingChatSessionStorageKey(teamId: string): string {
  return `${FLOATING_CHAT_SESSION_STORAGE_PREFIX}${teamId}:session`;
}

export function storeFloatingChatSessionId(
  storage: Storage,
  teamId: string,
  sessionId: string,
  now = Date.now(),
): boolean {
  const key = floatingChatSessionStorageKey(teamId);
  if (!SESSION_ID_RE.test(sessionId)) {
    removeStorageEntry(storage, key);
    return false;
  }

  const record: StoredFloatingChatSession = {
    version: 1,
    sessionId,
    expiresAt: now + FLOATING_CHAT_SESSION_MAX_AGE_MS,
  };
  try {
    storage.setItem(key, JSON.stringify(record));
    return true;
  } catch {
    return false;
  }
}

export function readFloatingChatSessionId(
  storage: Storage,
  teamId: string,
  now = Date.now(),
): string | null {
  return readStorageEntry(storage, floatingChatSessionStorageKey(teamId), now);
}

export function clearFloatingChatSessionId(storage: Storage, teamId: string): void {
  removeStorageEntry(storage, floatingChatSessionStorageKey(teamId));
}

export function pruneFloatingChatSessionIds(storage: Storage, now = Date.now()): void {
  for (let index = storage.length - 1; index >= 0; index -= 1) {
    const key = storage.key(index);
    if (!key?.startsWith(FLOATING_CHAT_SESSION_STORAGE_PREFIX)) continue;
    readStorageEntry(storage, key, now);
  }
}

export function clearAllFloatingChatSessionIds(storage: Storage): void {
  for (let index = storage.length - 1; index >= 0; index -= 1) {
    const key = storage.key(index);
    if (key?.startsWith(FLOATING_CHAT_SESSION_STORAGE_PREFIX)) {
      removeStorageEntry(storage, key);
    }
  }
}

function readStorageEntry(storage: Storage, key: string, now: number): string | null {
  let serialized: string | null;
  try {
    serialized = storage.getItem(key);
  } catch {
    return null;
  }
  if (!serialized) return null;

  try {
    const parsed = JSON.parse(serialized) as Partial<StoredFloatingChatSession>;
    const valid =
      parsed.version === 1 &&
      typeof parsed.sessionId === 'string' &&
      SESSION_ID_RE.test(parsed.sessionId) &&
      typeof parsed.expiresAt === 'number' &&
      Number.isFinite(parsed.expiresAt) &&
      parsed.expiresAt > now &&
      parsed.expiresAt <= now + FLOATING_CHAT_SESSION_MAX_AGE_MS;
    if (valid) return parsed.sessionId ?? null;
  } catch {
    // Legacy raw UUIDs and malformed records are removed below.
  }

  removeStorageEntry(storage, key);
  return null;
}

function removeStorageEntry(storage: Storage, key: string): void {
  try {
    storage.removeItem(key);
  } catch {
    // Storage may be unavailable in hardened/private browser contexts.
  }
}
