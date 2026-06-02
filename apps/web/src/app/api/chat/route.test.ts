import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Route-handler tests for `/api/chat`. Agent/tool implementations own their
 * own behavior; this route owns auth/config/rate gates, session persistence
 * decisions, UI-message validation, scoped tool construction, stream response
 * metadata, and non-fatal failure handling.
 */

const fakes = vi.hoisted(() => ({
  fakeAuth: vi.fn(),
  fakeResolveActiveTeam: vi.fn(),
  fakeGetEnv: vi.fn(),
  fakeRequireMembership: vi.fn(),
  fakeCheckRateLimit: vi.fn(),
  fakeTeam: vi.fn(),
  fakeChatSessionExists: vi.fn(),
  fakeCreateChatSession: vi.fn(),
  fakeGetCalendarSettings: vi.fn(),
  fakeBuildSystemPrompt: vi.fn(),
  fakeBuildAgentTools: vi.fn(),
  fakeBuildMcpTools: vi.fn(),
  fakeWorkspaceTimeContext: vi.fn(),
  fakeSafeValidateUIMessages: vi.fn(),
  fakeConvertToModelMessages: vi.fn(),
  fakeResolveAgentModelId: vi.fn(),
  fakeBuildOpenRouterLanguageModel: vi.fn(),
  fakeCompressMessagesForContext: vi.fn(),
  fakeStreamChat: vi.fn(),
  fakeAppendChatMessages: vi.fn(),
  fakeLoggerWarn: vi.fn(),
  fakeLoggerInfo: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ auth: fakes.fakeAuth }));
vi.mock('@/lib/active-team', () => ({ resolveActiveTeam: fakes.fakeResolveActiveTeam }));
vi.mock('@/lib/db', () => ({ db: {} }));
vi.mock('@timeline/shared/env', () => ({ getEnv: fakes.fakeGetEnv }));
vi.mock('@timeline/shared/logger', () => ({
  childLogger: () => ({ info: fakes.fakeLoggerInfo, warn: fakes.fakeLoggerWarn }),
}));
vi.mock('@timeline/shared/rate-limit', () => ({
  RATE_LIMITS: { aiChat: { limit: 5, windowMs: 60_000 } },
  checkRateLimit: fakes.fakeCheckRateLimit,
  rateLimitKey: (...parts: string[]) => parts.join(':'),
}));
vi.mock('@timeline/shared/team-scope', () => ({
  withTeam: () => ({
    requireMembership: fakes.fakeRequireMembership,
    timeline: { team: fakes.fakeTeam },
    objects: {
      chatSessionExists: fakes.fakeChatSessionExists,
      createChatSession: fakes.fakeCreateChatSession,
    },
    calendar: { getCalendarSettings: fakes.fakeGetCalendarSettings },
  }),
}));
vi.mock('@timeline/shared/agent', () => ({
  AGENT_PROMPT_VERSION: 'test-prompt-v1',
  buildSystemPrompt: fakes.fakeBuildSystemPrompt,
  buildAgentTools: fakes.fakeBuildAgentTools,
  buildMcpTools: fakes.fakeBuildMcpTools,
}));
vi.mock('@timeline/shared/time', () => ({
  workspaceTimeContext: fakes.fakeWorkspaceTimeContext,
}));
vi.mock('@timeline/shared/objects', () => ({
  appendChatMessages: fakes.fakeAppendChatMessages,
}));
vi.mock('@timeline/shared/llm', () => ({
  DEFAULT_CHAT_MEMORY: { maxRequestMessages: 50 },
  TIMELINE_MODELS: {
    agent: { contextWindowTokens: 128_000 },
    summarization: { id: 'summarizer-model' },
  },
  buildOpenRouterLanguageModel: fakes.fakeBuildOpenRouterLanguageModel,
  compressMessagesForContext: fakes.fakeCompressMessagesForContext,
  resolveAgentModelId: fakes.fakeResolveAgentModelId,
  streamChat: fakes.fakeStreamChat,
}));
vi.mock('ai', () => ({
  convertToModelMessages: fakes.fakeConvertToModelMessages,
  safeValidateUIMessages: fakes.fakeSafeValidateUIMessages,
}));

const { POST } = await import('./route.js');

const TEAM_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const SESSION_ID = '33333333-3333-4333-8333-333333333333';
const PINNED_ID = '44444444-4444-4444-8444-444444444444';

const userMessage = { id: 'm1', role: 'user', parts: [{ type: 'text', text: 'What happened?' }] };
let capturedOnFinish: ((event: Record<string, unknown>) => void) | null = null;

function request(body: unknown, url = 'https://timeline.test/api/chat'): Request {
  return new Request(url, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

function validBody(overrides: Record<string, unknown> = {}) {
  return { messages: [userMessage], ...overrides };
}

function streamResponse(body = 'chat stream'): Response {
  return new Response(body, { status: 200 });
}

beforeEach(() => {
  vi.clearAllMocks();
  capturedOnFinish = null;
  fakes.fakeAuth.mockResolvedValue({
    user: { id: USER_ID, name: 'Tim', email: 'tim@example.test' },
  });
  fakes.fakeResolveActiveTeam.mockResolvedValue({
    active: { teamId: TEAM_ID, teamName: 'Timeline E2E' },
  });
  fakes.fakeGetEnv.mockReturnValue({
    OPENROUTER_API_KEY: 'test-openrouter',
    QDRANT_URL: 'https://qdrant.test',
  });
  fakes.fakeRequireMembership.mockResolvedValue('member');
  fakes.fakeCheckRateLimit.mockResolvedValue({ ok: true, remaining: 4, retryAfterMs: 0 });
  fakes.fakeTeam.mockResolvedValue({ name: 'Team From Scope' });
  fakes.fakeChatSessionExists.mockResolvedValue(true);
  fakes.fakeCreateChatSession.mockResolvedValue({ id: SESSION_ID });
  fakes.fakeGetCalendarSettings.mockResolvedValue({ defaultTimezone: 'Europe/Tallinn' });
  fakes.fakeWorkspaceTimeContext.mockReturnValue('Tallinn time');
  fakes.fakeBuildSystemPrompt.mockReturnValue('system prompt');
  fakes.fakeBuildAgentTools.mockReturnValue({ search_timeline: { type: 'native' } });
  fakes.fakeBuildMcpTools.mockResolvedValue({ external_tool: { type: 'mcp' } });
  fakes.fakeSafeValidateUIMessages.mockResolvedValue({
    success: true,
    data: [userMessage],
  });
  fakes.fakeConvertToModelMessages.mockResolvedValue([{ role: 'user', content: 'What happened?' }]);
  fakes.fakeResolveAgentModelId.mockReturnValue('agent-model');
  fakes.fakeBuildOpenRouterLanguageModel.mockReturnValue({ model: 'summarizer' });
  fakes.fakeCompressMessagesForContext.mockResolvedValue({
    compressed: false,
    messages: [{ role: 'user', content: 'What happened?' }],
  });
  fakes.fakeStreamChat.mockImplementation(
    (input: { onFinish?: (event: Record<string, unknown>) => void }) => {
      capturedOnFinish = input.onFinish ?? null;
      return { toUIMessageStreamResponse: () => streamResponse() };
    },
  );
  fakes.fakeAppendChatMessages.mockResolvedValue(undefined);
});

describe('POST /api/chat', () => {
  it('rejects unauthenticated users and unconfigured chat before parsing body', async () => {
    fakes.fakeAuth.mockResolvedValue(null);
    const unauthenticated = await POST(request(validBody()));
    expect(unauthenticated.status).toBe(401);
    await expect(unauthenticated.json()).resolves.toEqual({
      ok: false,
      error: 'unauthenticated',
    });

    fakes.fakeAuth.mockResolvedValue({ user: { id: USER_ID } });
    fakes.fakeGetEnv.mockReturnValue({ OPENROUTER_API_KEY: '', QDRANT_URL: 'https://qdrant.test' });
    const unconfigured = await POST(request(validBody()));
    expect(unconfigured.status).toBe(503);
    await expect(unconfigured.json()).resolves.toEqual({
      ok: false,
      error: 'chat_unconfigured',
    });
  });

  it('validates JSON and schema before resolving the active team', async () => {
    const badJson = await POST(
      new Request('https://timeline.test/api/chat', { method: 'POST', body: '{' }),
    );
    expect(badJson.status).toBe(400);
    await expect(badJson.json()).resolves.toEqual({ ok: false, error: 'invalid_json' });

    const badSchema = await POST(request({ messages: 'not-an-array' }));
    expect(badSchema.status).toBe(400);
    const payload = (await badSchema.json()) as { ok: false; error: string };
    expect(payload.error).toBeTypeOf('string');
    expect(fakes.fakeResolveActiveTeam).not.toHaveBeenCalled();
  });

  it('returns no-active-team, not-a-member, and rate-limit responses', async () => {
    fakes.fakeResolveActiveTeam.mockResolvedValue({ active: null });
    const noTeam = await POST(request(validBody()));
    expect(noTeam.status).toBe(400);
    await expect(noTeam.json()).resolves.toEqual({ ok: false, error: 'no_active_team' });

    fakes.fakeResolveActiveTeam.mockResolvedValue({
      active: { teamId: TEAM_ID, teamName: 'Timeline E2E' },
    });
    fakes.fakeRequireMembership.mockRejectedValueOnce(new Error('forbidden'));
    const notMember = await POST(request(validBody()));
    expect(notMember.status).toBe(403);
    await expect(notMember.json()).resolves.toEqual({ ok: false, error: 'not_a_member' });

    fakes.fakeCheckRateLimit.mockResolvedValue({ ok: false, retryAfterMs: 2500 });
    const limited = await POST(request(validBody()));
    expect(limited.status).toBe(429);
    expect(limited.headers.get('Retry-After')).toBe('3');
    await expect(limited.json()).resolves.toEqual({ ok: false, error: 'rate_limited' });
  });

  it('returns invalid_messages when AI SDK UI-message validation fails', async () => {
    fakes.fakeSafeValidateUIMessages.mockResolvedValue({ success: false });

    const response = await POST(request(validBody()));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ ok: false, error: 'invalid_messages' });
    expect(fakes.fakeStreamChat).not.toHaveBeenCalled();
  });

  it('requires an existing persisted session when sessionId is provided', async () => {
    fakes.fakeChatSessionExists.mockResolvedValue(false);

    const response = await POST(request(validBody({ sessionId: SESSION_ID })));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ ok: false, error: 'session_not_found' });
    expect(fakes.fakeStreamChat).not.toHaveBeenCalled();
  });

  it('honors query session fallback and streams with scoped tools and workspace context', async () => {
    const response = await POST(
      request(validBody(), `https://timeline.test/api/chat?session=${SESSION_ID}`),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('x-tl-session-id')).toBe(SESSION_ID);
    await expect(response.text()).resolves.toBe('chat stream');
    expect(fakes.fakeChatSessionExists).toHaveBeenCalledWith(SESSION_ID);
    expect(fakes.fakeWorkspaceTimeContext).toHaveBeenCalledWith('Europe/Tallinn', expect.any(Date));
    expect(fakes.fakeBuildSystemPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        teamName: 'Team From Scope',
        userName: 'Tim',
        workspaceTime: 'Tallinn time',
      }),
    );
    expect(fakes.fakeStreamChat).toHaveBeenCalledWith(
      expect.objectContaining({
        system: 'system prompt',
        messages: [{ role: 'user', content: 'What happened?' }],
        tools: {
          search_timeline: { type: 'native' },
          external_tool: { type: 'mcp' },
        },
        model: 'agent-model',
        maxSteps: 5,
      }),
    );
  });

  it('starts a new persisted session and returns its id header', async () => {
    const response = await POST(
      request(validBody({ startNewSession: true, pinnedEntityId: PINNED_ID })),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('x-tl-session-id')).toBe(SESSION_ID);
    expect(fakes.fakeCreateChatSession).toHaveBeenCalledWith({ pinnedEntityId: PINNED_ID });
  });

  it('tolerates new-session creation and MCP discovery failures by streaming without persistence', async () => {
    fakes.fakeCreateChatSession.mockRejectedValue(new Error('bad pinned object'));
    fakes.fakeBuildMcpTools.mockRejectedValue(new Error('mcp down'));

    const response = await POST(
      request(validBody({ startNewSession: true, pinnedEntityId: PINNED_ID })),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('x-tl-session-id')).toBeNull();
    const createSessionWarning = fakes.fakeLoggerWarn.mock.calls.find(
      (call) => call[1] === 'chat session create failed',
    )?.[0] as { err?: unknown } | undefined;
    expect(createSessionWarning?.err).toBeInstanceOf(Error);
    expect(fakes.fakeLoggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({ teamId: TEAM_ID }),
      'mcp tool discovery failed; chat continues with native tools only',
    );
  });

  it('persists latest user turn and assistant turn on finish, logging append failures without changing response', async () => {
    fakes.fakeAppendChatMessages.mockRejectedValue(new Error('append failed'));
    const response = await POST(request(validBody({ sessionId: SESSION_ID })));

    expect(response.status).toBe(200);
    expect(capturedOnFinish).toBeTypeOf('function');
    capturedOnFinish?.({
      text: 'Answer',
      toolCalls: [{ toolName: 'search_timeline' }],
      finishReason: 'stop',
      usage: { inputTokens: 10, outputTokens: 5 },
    });
    await Promise.resolve();

    expect(fakes.fakeAppendChatMessages).toHaveBeenCalledWith({}, expect.anything(), SESSION_ID, [
      { role: 'user', authorUserId: USER_ID, content: { ui_message: userMessage } },
      {
        role: 'assistant',
        content: {
          text: 'Answer',
          tool_calls: [{ toolName: 'search_timeline' }],
          finish_reason: 'stop',
          usage: { inputTokens: 10, outputTokens: 5 },
          prompt_version: 'test-prompt-v1',
        },
      },
    ]);
    await Promise.resolve();
    expect(fakes.fakeLoggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: SESSION_ID, teamId: TEAM_ID, userId: USER_ID }),
      'chat session append failed',
    );
  });
});
