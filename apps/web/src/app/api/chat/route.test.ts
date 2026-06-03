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
  fakeCurrentUserIdentityContext: vi.fn(),
  fakeChatSessionExists: vi.fn(),
  fakeCreateChatSession: vi.fn(),
  fakeListObjects: vi.fn(),
  fakeGetCalendarSettings: vi.fn(),
  fakeListCalendarEvents: vi.fn(),
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
  fakeCreateUIMessageStream: vi.fn(),
  fakeCreateUIMessageStreamResponse: vi.fn(),
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
    timeline: {
      team: fakes.fakeTeam,
      currentUserIdentityContext: fakes.fakeCurrentUserIdentityContext,
    },
    objects: {
      chatSessionExists: fakes.fakeChatSessionExists,
      createChatSession: fakes.fakeCreateChatSession,
      listObjects: fakes.fakeListObjects,
    },
    calendar: {
      getCalendarSettings: fakes.fakeGetCalendarSettings,
      listCalendarEvents: fakes.fakeListCalendarEvents,
    },
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
  createUIMessageStream: fakes.fakeCreateUIMessageStream,
  createUIMessageStreamResponse: fakes.fakeCreateUIMessageStreamResponse,
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

interface TestStreamChunk {
  type?: unknown;
  toolName?: unknown;
  output?: unknown;
  delta?: unknown;
}

function isStreamBody(value: unknown): value is { chunks: TestStreamChunk[] } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'chunks' in value &&
    Array.isArray((value as { chunks?: unknown }).chunks)
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  capturedOnFinish = null;
  delete process.env.E2E_DETERMINISTIC_CHAT;
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
  fakes.fakeCurrentUserIdentityContext.mockResolvedValue({
    userId: USER_ID,
    role: 'member',
    name: 'Tim',
    email: 'tim@example.test',
    person: null,
    facets: [],
  });
  fakes.fakeChatSessionExists.mockResolvedValue(true);
  fakes.fakeCreateChatSession.mockResolvedValue({ id: SESSION_ID });
  fakes.fakeListObjects.mockImplementation((filter?: { type?: string }) =>
    filter?.type === 'task'
      ? Promise.resolve([
          {
            id: '55555555-5555-4555-8555-555555555555',
            type: 'task',
            canonicalName: 'Durable task',
            status: 'todo',
            stage: null,
            dueAt: null,
          },
        ])
      : Promise.resolve([
          {
            id: '66666666-6666-4666-8666-666666666666',
            type: 'project',
            canonicalName: 'Durable object',
            status: 'active',
            stage: 'review',
            dueAt: null,
          },
        ]),
  );
  fakes.fakeGetCalendarSettings.mockResolvedValue({ defaultTimezone: 'Europe/Tallinn' });
  fakes.fakeListCalendarEvents.mockResolvedValue([
    {
      id: '77777777-7777-4777-8777-777777777777',
      title: 'Durable calendar event',
      description: null,
      location: null,
      startAt: new Date('2026-06-09T00:00:00.000Z'),
      allDay: true,
    },
  ]);
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
  fakes.fakeCreateUIMessageStream.mockImplementation(
    (input: { execute: (args: unknown) => void }) => {
      const chunks: unknown[] = [];
      input.execute({
        writer: {
          write: (chunk: unknown) => {
            chunks.push(chunk);
          },
        },
      });
      return { chunks };
    },
  );
  fakes.fakeCreateUIMessageStreamResponse.mockImplementation(
    ({ stream }: { stream: { chunks: unknown[] } }) =>
      Response.json({ chunks: stream.chunks }, { status: 200 }),
  );
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
        currentUser: {
          userId: USER_ID,
          role: 'member',
          name: 'Tim',
          email: 'tim@example.test',
          person: null,
          facets: [],
        },
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

  it('streams deterministic durable workspace state without bypassing route gates', async () => {
    process.env.E2E_DETERMINISTIC_CHAT = '1';
    const durableMessage = {
      id: 'm-durable',
      role: 'user',
      parts: [{ type: 'text', text: 'What durable task calendar object state exists?' }],
    };
    fakes.fakeSafeValidateUIMessages.mockResolvedValue({
      success: true,
      data: [durableMessage],
    });

    const response = await POST(
      request(validBody({ messages: [durableMessage], sessionId: SESSION_ID })),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('x-tl-session-id')).toBe(SESSION_ID);
    expect(fakes.fakeRequireMembership).toHaveBeenCalled();
    expect(fakes.fakeChatSessionExists).toHaveBeenCalledWith(SESSION_ID);
    expect(fakes.fakeListObjects).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'task', archived: false, limit: 50 }),
    );
    expect(fakes.fakeListObjects).toHaveBeenCalledWith(
      expect.objectContaining({ archived: false, limit: 50 }),
    );
    const calendarCall = fakes.fakeListCalendarEvents.mock.calls.at(0) as unknown as
      | [{ from: Date; to: Date; limit: number }]
      | undefined;
    expect(calendarCall?.[0].from).toBeInstanceOf(Date);
    expect(calendarCall?.[0].to).toBeInstanceOf(Date);
    expect(calendarCall?.[0].limit).toBe(50);
    expect(fakes.fakeStreamChat).not.toHaveBeenCalled();
    expect(fakes.fakeConvertToModelMessages).not.toHaveBeenCalled();
    const body: unknown = await response.json();
    if (!isStreamBody(body)) throw new Error('expected deterministic stream chunks');
    expect(
      body.chunks.some(
        (chunk) =>
          chunk.type === 'tool-input-available' && chunk.toolName === 'list_workspace_state',
      ),
    ).toBe(true);
    expect(
      body.chunks.some((chunk) => {
        if (chunk.type !== 'tool-output-available') return false;
        const output = chunk.output as { count?: unknown } | undefined;
        return output?.count === 3;
      }),
    ).toBe(true);
    expect(
      body.chunks.some(
        (chunk) => chunk.type === 'text-delta' && String(chunk.delta).includes('Durable object'),
      ),
    ).toBe(true);
    const appendCall = fakes.fakeAppendChatMessages.mock.calls.at(-1) as unknown as
      | [
          unknown,
          unknown,
          string,
          [
            { role: string; authorUserId?: string; content: unknown },
            {
              role: string;
              content: {
                text?: string;
                tool_calls?: { toolName?: string; output?: { count?: number } }[];
              };
            },
          ],
        ]
      | undefined;
    expect(appendCall?.[2]).toBe(SESSION_ID);
    expect(appendCall?.[3][0]).toEqual({
      role: 'user',
      authorUserId: USER_ID,
      content: { ui_message: durableMessage },
    });
    expect(appendCall?.[3][1].role).toBe('assistant');
    expect(appendCall?.[3][1].content.text).toContain('Durable calendar event');
    expect(appendCall?.[3][1].content.tool_calls?.[0]?.toolName).toBe('list_workspace_state');
    expect(appendCall?.[3][1].content.tool_calls?.[0]?.output?.count).toBe(3);
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
