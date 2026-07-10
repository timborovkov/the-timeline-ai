import { beforeEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({
  archiveChatSession: vi.fn(),
  getChatSession: vi.fn(),
  hydrateChatSessionMessages: vi.fn(),
  linkChatSessionToObject: vi.fn(),
  reportCaughtError: vi.fn(),
  resolveScope: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock('@/lib/action-scope', async () => {
  const { z } = await import('zod');
  return {
    resolveScope: fakes.resolveScope,
    uuidSchema: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i),
  };
});
vi.mock('@/lib/chat-session', () => ({
  hydrateChatSessionMessages: fakes.hydrateChatSessionMessages,
}));
vi.mock('@/lib/sentry-action', () => ({
  runSentryServerAction: (_name: string, callback: () => Promise<unknown>) => callback(),
}));
vi.mock('@/lib/sentry-report', () => ({ reportCaughtError: fakes.reportCaughtError }));
vi.mock('next/cache', () => ({ revalidatePath: fakes.revalidatePath }));

const { archiveChatSessionAction, loadChatSessionAction, unpinChatSessionAction } =
  await import('./chat.js');

const SESSION_ID = '11111111-1111-4111-8111-111111111111';

function okScope() {
  return {
    ok: true,
    scope: {
      objects: {
        archiveChatSession: fakes.archiveChatSession,
        getChatSession: fakes.getChatSession,
        linkChatSessionToObject: fakes.linkChatSessionToObject,
      },
    },
    teamId: '22222222-2222-4222-8222-222222222222',
    userId: '33333333-3333-4333-8333-333333333333',
  };
}

function errorReferenceFrom(context: unknown): unknown {
  if (!context || typeof context !== 'object') return undefined;
  const tags = (context as { tags?: unknown }).tags;
  if (!tags || typeof tags !== 'object') return undefined;
  return (tags as { error_reference?: unknown }).error_reference;
}

beforeEach(() => {
  vi.clearAllMocks();
  fakes.resolveScope.mockResolvedValue(okScope());
  fakes.archiveChatSession.mockResolvedValue(undefined);
  fakes.linkChatSessionToObject.mockResolvedValue(undefined);
  fakes.getChatSession.mockResolvedValue({ id: SESSION_ID, messages: [] });
  fakes.hydrateChatSessionMessages.mockReturnValue([
    { id: 'message-1', role: 'assistant', parts: [{ type: 'text', text: 'Hello' }] },
  ]);
});

describe('chat actions', () => {
  it('rejects invalid ids and missing scope before touching chat sessions', async () => {
    await expect(archiveChatSessionAction({ sessionId: 'not-a-uuid' })).resolves.toEqual({
      error: 'Invalid id',
    });
    await expect(unpinChatSessionAction({})).resolves.toEqual({ error: 'Invalid id' });
    await expect(loadChatSessionAction({ sessionId: 'not-a-uuid' })).resolves.toEqual({
      ok: false,
      error: 'Invalid id',
    });
    expect(fakes.resolveScope).not.toHaveBeenCalled();

    fakes.resolveScope.mockResolvedValueOnce({ ok: false, error: 'Not signed in' });
    await expect(archiveChatSessionAction({ sessionId: SESSION_ID })).resolves.toEqual({
      error: 'Not signed in',
    });
    expect(fakes.archiveChatSession).not.toHaveBeenCalled();
  });

  it('archives and unpins sessions, then revalidates chat', async () => {
    await expect(archiveChatSessionAction({ sessionId: SESSION_ID })).resolves.toEqual({
      ok: true,
    });
    expect(fakes.archiveChatSession).toHaveBeenCalledWith(SESSION_ID);
    expect(fakes.revalidatePath).toHaveBeenCalledWith('/app/chat');

    await expect(unpinChatSessionAction({ sessionId: SESSION_ID })).resolves.toEqual({
      ok: true,
    });
    expect(fakes.linkChatSessionToObject).toHaveBeenCalledWith(SESSION_ID, null);
    expect(fakes.revalidatePath).toHaveBeenCalledWith('/app/chat');
  });

  it('reports archive and unpin failures without revalidating stale state', async () => {
    const archiveErr = new Error('archive denied');
    fakes.archiveChatSession.mockRejectedValueOnce(archiveErr);

    const archiveResult = await archiveChatSessionAction({ sessionId: SESSION_ID });
    expect(archiveResult.error).toMatch(/^Failed to archive session\. Reference: [0-9a-f]{8}\.$/);
    expect(fakes.reportCaughtError.mock.calls[0]?.[0]).toBe(archiveErr);
    const archiveContext: unknown = fakes.reportCaughtError.mock.calls[0]?.[1];
    expect(archiveContext).toMatchObject({
      surface: 'server_action',
      operation: 'archive_chat_session',
    });
    expect(errorReferenceFrom(archiveContext)).toMatch(/^[0-9a-f]{8}$/);

    const unpinErr = new Error('cross-team object');
    fakes.linkChatSessionToObject.mockRejectedValueOnce(unpinErr);

    const unpinResult = await unpinChatSessionAction({ sessionId: SESSION_ID });
    expect(unpinResult.error).toMatch(/^Failed to unpin chat session\. Reference: [0-9a-f]{8}\.$/);
    expect(fakes.reportCaughtError.mock.calls[1]?.[0]).toBe(unpinErr);
    const unpinContext: unknown = fakes.reportCaughtError.mock.calls[1]?.[1];
    expect(unpinContext).toMatchObject({
      surface: 'server_action',
      operation: 'unpin_chat_session',
    });
    expect(errorReferenceFrom(unpinContext)).toMatch(/^[0-9a-f]{8}$/);
    expect(fakes.revalidatePath).not.toHaveBeenCalled();
  });

  it('loads and hydrates persisted messages or reports not-found/session failures', async () => {
    await expect(loadChatSessionAction({ sessionId: SESSION_ID })).resolves.toEqual({
      ok: true,
      messages: [{ id: 'message-1', role: 'assistant', parts: [{ type: 'text', text: 'Hello' }] }],
    });
    expect(fakes.getChatSession).toHaveBeenCalledWith(SESSION_ID);
    expect(fakes.hydrateChatSessionMessages).toHaveBeenCalledWith({ id: SESSION_ID, messages: [] });

    fakes.getChatSession.mockResolvedValueOnce(null);
    await expect(loadChatSessionAction({ sessionId: SESSION_ID })).resolves.toEqual({
      ok: false,
      error: 'Session not found',
    });

    const err = new Error('db offline');
    fakes.getChatSession.mockRejectedValueOnce(err);
    const loadResult = await loadChatSessionAction({ sessionId: SESSION_ID });
    expect(loadResult).toMatchObject({ ok: false });
    expect(loadResult.error).toMatch(/^Failed to load chat session\. Reference: [0-9a-f]{8}\.$/);
    expect(fakes.reportCaughtError.mock.calls[0]?.[0]).toBe(err);
    const loadContext: unknown = fakes.reportCaughtError.mock.calls[0]?.[1];
    expect(loadContext).toMatchObject({
      surface: 'server_action',
      operation: 'load_chat_session_messages',
    });
    expect(errorReferenceFrom(loadContext)).toMatch(/^[0-9a-f]{8}$/);
  });
});
