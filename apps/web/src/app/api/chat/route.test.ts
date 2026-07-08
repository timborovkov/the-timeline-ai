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
  fakeChatSessionTitleStatus: vi.fn(),
  fakeCreateChatSession: vi.fn(),
  fakeListChatSessions: vi.fn(),
  fakeSetChatSessionTitle: vi.fn(),
  fakeSetUniqueChatSessionTitle: vi.fn(),
  fakeListObjects: vi.fn(),
  fakeGetCalendarSettings: vi.fn(),
  fakeListCalendarEvents: vi.fn(),
  fakeBuildSystemPrompt: vi.fn(),
  fakeBuildAgentTools: vi.fn(),
  fakeBuildMcpTools: vi.fn(),
  fakeInstrumentAgentTools: vi.fn(),
  fakeSummarizeAgentToolObservations: vi.fn(),
  fakeWorkspaceTimeContext: vi.fn(),
  fakeSafeValidateUIMessages: vi.fn(),
  fakeConvertToModelMessages: vi.fn(),
  fakeResolveAgentModelId: vi.fn(),
  fakeBuildOpenRouterLanguageModel: vi.fn(),
  fakeCompressMessagesForContext: vi.fn(),
  fakeChatStructured: vi.fn(),
  fakeStreamChat: vi.fn(),
  fakeAppendChatMessages: vi.fn(),
  fakeCreateUIMessageStream: vi.fn(),
  fakeCreateUIMessageStreamResponse: vi.fn(),
  fakeLoggerWarn: vi.fn(),
  fakeLoggerInfo: vi.fn(),
  fakeReportCaughtError: vi.fn(),
  fakeReportHandledEvent: vi.fn(),
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
      chatSessionTitleStatus: fakes.fakeChatSessionTitleStatus,
      createChatSession: fakes.fakeCreateChatSession,
      listChatSessions: fakes.fakeListChatSessions,
      setChatSessionTitle: fakes.fakeSetChatSessionTitle,
      setUniqueChatSessionTitle: fakes.fakeSetUniqueChatSessionTitle,
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
  instrumentAgentTools: fakes.fakeInstrumentAgentTools,
  summarizeAgentToolObservations: fakes.fakeSummarizeAgentToolObservations,
}));
vi.mock('@timeline/shared/time', () => ({
  workspaceTimeContext: fakes.fakeWorkspaceTimeContext,
}));
vi.mock('@timeline/shared/objects', () => ({
  appendChatMessages: fakes.fakeAppendChatMessages,
}));
vi.mock('@timeline/shared/llm', () => ({
  DEFAULT_AGENT_MAX_STEPS: 20,
  DEFAULT_CHAT_MEMORY: { maxRequestMessages: 50 },
  TIMELINE_MODELS: {
    agent: { contextWindowTokens: 128_000 },
    summarization: { id: 'summarizer-model' },
  },
  buildOpenRouterLanguageModel: fakes.fakeBuildOpenRouterLanguageModel,
  compressMessagesForContext: fakes.fakeCompressMessagesForContext,
  chatStructured: fakes.fakeChatStructured,
  resolveAgentModelId: fakes.fakeResolveAgentModelId,
  streamChatFallbackModelIds: (modelId: string) =>
    modelId === 'fallback-agent-model' ? [] : ['fallback-agent-model'],
  streamChatModelAttribution: (
    event: { model?: { modelId?: string }; response?: { modelId?: string } },
    requestedModelId?: string,
  ) => ({
    requestedModelId: requestedModelId ?? event.model?.modelId ?? 'agent-model',
    responseModelId: event.response?.modelId ?? event.model?.modelId ?? requestedModelId,
    fallbackModelIds: requestedModelId === 'fallback-agent-model' ? [] : ['fallback-agent-model'],
  }),
  streamChat: fakes.fakeStreamChat,
}));
vi.mock('@/lib/sentry-report', () => ({
  reportCaughtError: fakes.fakeReportCaughtError,
  reportHandledEvent: fakes.fakeReportHandledEvent,
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
const followUpMessage = {
  id: 'm2',
  role: 'user',
  parts: [{ type: 'text', text: 'What changed since then?' }],
};
let capturedOnFinish: ((event: Record<string, unknown>) => void) | null = null;
let capturedOnError: ((event: { error: unknown }) => void) | null = null;

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
  capturedOnError = null;
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
  fakes.fakeChatSessionTitleStatus.mockResolvedValue({ exists: true, needsTitle: false });
  fakes.fakeCreateChatSession.mockResolvedValue({ id: SESSION_ID, title: null });
  fakes.fakeListChatSessions.mockResolvedValue([]);
  fakes.fakeSetChatSessionTitle.mockResolvedValue(undefined);
  fakes.fakeSetUniqueChatSessionTitle.mockResolvedValue(undefined);
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
  fakes.fakeInstrumentAgentTools.mockImplementation((tools: unknown) => tools);
  fakes.fakeSummarizeAgentToolObservations.mockImplementation(
    (input: { observations: unknown[]; selection?: unknown }) => ({
      toolObservations: input.observations,
      selection: input.selection ?? null,
      totalResultCount: 0,
      topArtifactRefs: [],
      warningCodes: [],
    }),
  );
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
  fakes.fakeChatStructured.mockResolvedValue({ object: { title: 'Generated chat title' } });
  fakes.fakeStreamChat.mockImplementation(
    (input: {
      onError?: (event: { error: unknown }) => void;
      onFinish?: (event: Record<string, unknown>) => void;
    }) => {
      capturedOnError = input.onError ?? null;
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
    fakes.fakeChatSessionTitleStatus.mockResolvedValue({ exists: false, needsTitle: false });

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
    expect(fakes.fakeChatSessionTitleStatus).toHaveBeenCalledWith(SESSION_ID);
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
        },
        model: 'agent-model',
        maxSteps: 20,
      }),
    );
    expect(fakes.fakeBuildMcpTools).not.toHaveBeenCalled();
  });

  it('adds dashboard route context to the model system prompt without trusting it as data', async () => {
    const response = await POST(
      request(
        validBody({
          dashboardContext: {
            pathname: '/app/objects/44444444-4444-4444-8444-444444444444',
            routeKind: 'objects',
            objectId: '44444444-4444-4444-8444-444444444444',
            search: { tab: 'notes' },
          },
        }),
      ),
    );

    expect(response.status).toBe(200);
    expect(fakes.fakeStreamChat).toHaveBeenCalled();
    const streamCall = fakes.fakeStreamChat.mock.calls.at(-1) as unknown as
      | [{ system?: string }]
      | undefined;
    expect(streamCall?.[0].system).toEqual(expect.stringContaining('DASHBOARD CONTEXT:'));
    expect(streamCall?.[0].system).toEqual(expect.stringContaining('/app/objects/'));
    expect(streamCall?.[0].system).toEqual(expect.stringContaining('object_id'));
    expect(streamCall?.[0].system).toEqual(
      expect.stringContaining('use tools before making claims'),
    );
  });

  it('adds object tools when dashboard context points at an object', async () => {
    fakes.fakeBuildAgentTools.mockReturnValue({
      retrieve_workspace_context: { type: 'native' },
      search_timeline: { type: 'native' },
      search_app_guide: { type: 'native' },
      get_app_route: { type: 'native' },
      get_object: { type: 'native' },
      search_objects: { type: 'native' },
      list_pending_approvals: { type: 'native' },
      suggest_object_memory: { type: 'native' },
      execute_object_update: { type: 'native' },
    });

    const response = await POST(
      request(
        validBody({
          dashboardContext: {
            pathname: '/app/objects/44444444-4444-4444-8444-444444444444',
            routeKind: 'objects',
            objectId: '44444444-4444-4444-8444-444444444444',
          },
        }),
      ),
    );

    expect(response.status).toBe(200);
    const streamCall = fakes.fakeStreamChat.mock.calls.at(-1) as unknown as
      | [{ tools?: Record<string, unknown> }]
      | undefined;
    expect(streamCall?.[0].tools).toMatchObject({
      retrieve_workspace_context: { type: 'native' },
      search_timeline: { type: 'native' },
      search_app_guide: { type: 'native' },
      get_app_route: { type: 'native' },
      get_object: { type: 'native' },
      search_objects: { type: 'native' },
      list_pending_approvals: { type: 'native' },
      suggest_object_memory: { type: 'native' },
    });
    expect(streamCall?.[0].tools).not.toHaveProperty('execute_object_update');
  });

  it('adds object-memory proposal tools for durable memory turns', async () => {
    const memoryMessage = {
      id: 'm-memory',
      role: 'user',
      parts: [{ type: 'text', text: 'Remember that AuditAL is an alias for AuditAI' }],
    };
    fakes.fakeSafeValidateUIMessages.mockResolvedValue({
      success: true,
      data: [memoryMessage],
    });
    fakes.fakeBuildAgentTools.mockReturnValue({
      retrieve_workspace_context: { type: 'native' },
      search_timeline: { type: 'native' },
      search_app_guide: { type: 'native' },
      get_app_route: { type: 'native' },
      get_object: { type: 'native' },
      search_objects: { type: 'native' },
      list_pending_approvals: { type: 'native' },
      suggest_task: { type: 'native' },
      suggest_object_memory: { type: 'native' },
      execute_object_update: { type: 'native' },
    });

    const response = await POST(request(validBody({ messages: [memoryMessage] })));

    expect(response.status).toBe(200);
    const streamCall = fakes.fakeStreamChat.mock.calls.at(-1) as unknown as
      | [{ tools?: Record<string, unknown> }]
      | undefined;
    expect(streamCall?.[0].tools).toMatchObject({
      search_objects: { type: 'native' },
      list_pending_approvals: { type: 'native' },
      suggest_object_memory: { type: 'native' },
    });
    expect(streamCall?.[0].tools).toMatchObject({
      suggest_task: { type: 'native' },
    });
    expect(streamCall?.[0].tools).not.toHaveProperty('execute_object_update');
  });

  it('adds action tools for completion-style commands on object context', async () => {
    const completionMessage = {
      id: 'm-complete',
      role: 'user',
      parts: [{ type: 'text', text: 'Mark this done' }],
    };
    fakes.fakeSafeValidateUIMessages.mockResolvedValue({
      success: true,
      data: [completionMessage],
    });
    fakes.fakeBuildAgentTools.mockReturnValue({
      retrieve_workspace_context: { type: 'native' },
      execute_object_update: { type: 'native' },
      execute_object_archive: { type: 'native' },
      search_app_guide: { type: 'native' },
      get_app_route: { type: 'native' },
      get_object: { type: 'native' },
      search_objects: { type: 'native' },
      search_timeline: { type: 'native' },
    });

    const response = await POST(
      request(
        validBody({
          messages: [completionMessage],
          dashboardContext: {
            pathname: '/app/objects/44444444-4444-4444-8444-444444444444',
            routeKind: 'objects',
            objectId: '44444444-4444-4444-8444-444444444444',
          },
        }),
      ),
    );

    expect(response.status).toBe(200);
    const streamCall = fakes.fakeStreamChat.mock.calls.at(-1) as unknown as
      | [{ tools?: Record<string, unknown> }]
      | undefined;
    expect(streamCall?.[0].tools).toMatchObject({
      execute_object_update: { type: 'native' },
    });
  });

  it('records dashboard action/HITL tool selection without inventing an action result', async () => {
    const completionMessage = {
      id: 'm-complete',
      role: 'user',
      parts: [{ type: 'text', text: 'Mark this done' }],
    };
    fakes.fakeSafeValidateUIMessages.mockResolvedValue({
      success: true,
      data: [completionMessage],
    });
    fakes.fakeBuildAgentTools.mockReturnValue({
      retrieve_workspace_context: { type: 'native' },
      search_timeline: { type: 'native' },
      search_app_guide: { type: 'native' },
      get_app_route: { type: 'native' },
      get_object: { type: 'native' },
      search_objects: { type: 'native' },
      list_objects: { type: 'native' },
      list_tasks: { type: 'native' },
      execute_object_update: { type: 'native' },
      execute_object_archive: { type: 'native' },
      suggest_task: { type: 'native' },
    });
    fakes.fakeSummarizeAgentToolObservations.mockImplementationOnce(
      (input: { observations: unknown[]; selection?: unknown }) => ({
        toolObservations: input.observations,
        selection: input.selection,
        totalResultCount: 0,
        topArtifactRefs: [],
        warningCodes: [],
      }),
    );

    const response = await POST(
      request(
        validBody({
          messages: [completionMessage],
          sessionId: SESSION_ID,
          dashboardContext: {
            pathname: '/app/objects/44444444-4444-4444-8444-444444444444',
            routeKind: 'objects',
            objectId: '44444444-4444-4444-8444-444444444444',
          },
        }),
      ),
    );

    expect(response.status).toBe(200);
    const streamCall = fakes.fakeStreamChat.mock.calls.at(-1) as unknown as
      | [{ system?: string; tools?: Record<string, unknown> }]
      | undefined;
    expect(streamCall?.[0].system).toEqual(expect.stringContaining('DASHBOARD CONTEXT:'));
    expect(streamCall?.[0].tools).toMatchObject({
      get_object: { type: 'native' },
      execute_object_update: { type: 'native' },
      suggest_task: { type: 'native' },
    });

    capturedOnFinish?.({
      text: 'I can update this once you confirm the exact status.',
      toolCalls: [],
      finishReason: 'stop',
      usage: { inputTokens: 14, outputTokens: 9 },
    });
    await Promise.resolve();

    const summarizeCall = fakes.fakeSummarizeAgentToolObservations.mock.calls.at(-1) as
      | [
          {
            selection?: {
              selectedToolGroups?: string[];
              omittedToolGroups?: string[];
              selectedNativeToolCount?: number;
              mcpDiscoverySkipped?: boolean;
            };
          },
        ]
      | undefined;
    expect(summarizeCall?.[0].selection).toMatchObject({
      selectedToolGroups: ['core', 'guide', 'objects', 'objectMemory', 'actions'],
      omittedToolGroups: [
        'suggestions',
        'boards',
        'documents',
        'calendar',
        'approvals',
        'integrations',
      ],
      selectedNativeToolCount: 11,
      mcpDiscoverySkipped: true,
    });

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
                text?: string | null;
                tool_calls?: unknown[];
                tool_observability?: { selection?: unknown };
              };
            },
          ],
        ]
      | undefined;
    expect(appendCall?.[2]).toBe(SESSION_ID);
    expect(appendCall?.[3][0]).toEqual({
      role: 'user',
      authorUserId: USER_ID,
      content: { ui_message: completionMessage },
    });
    expect(appendCall?.[3][1].content).toMatchObject({
      text: 'I can update this once you confirm the exact status.',
      tool_calls: [],
    });
    expect(appendCall?.[3][1].content.tool_observability?.selection).toMatchObject({
      selectedToolGroups: ['core', 'guide', 'objects', 'objectMemory', 'actions'],
    });
  });

  it('discovers MCP tools only for connected-source turns', async () => {
    const sourceMessage = {
      id: 'm-source',
      role: 'user',
      parts: [{ type: 'text', text: 'Search our connected Slack source for launch notes' }],
    };
    fakes.fakeSafeValidateUIMessages.mockResolvedValue({
      success: true,
      data: [sourceMessage],
    });

    const response = await POST(request(validBody({ messages: [sourceMessage] })));

    expect(response.status).toBe(200);
    expect(fakes.fakeBuildMcpTools).toHaveBeenCalled();
    const streamCall = fakes.fakeStreamChat.mock.calls.at(-1) as unknown as
      | [{ tools?: Record<string, unknown> }]
      | undefined;
    expect(streamCall?.[0].tools).toMatchObject({
      search_timeline: { type: 'native' },
      external_tool: { type: 'mcp' },
    });
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
    expect(fakes.fakeChatSessionTitleStatus).toHaveBeenCalledWith(SESSION_ID);
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

  it('titles a newly-created session from the first user turn without renaming existing sessions', async () => {
    const response = await POST(request(validBody({ startNewSession: true })));

    expect(response.status).toBe(200);
    capturedOnFinish?.({
      text: 'Answer',
      toolCalls: [],
      finishReason: 'stop',
      usage: { inputTokens: 10, outputTokens: 5 },
    });
    await vi.waitFor(() => {
      expect(fakes.fakeSetUniqueChatSessionTitle).toHaveBeenCalled();
    });

    const titleCall = fakes.fakeChatStructured.mock.calls.at(0) as unknown as
      | [{ schema?: unknown; model?: unknown; prompt?: unknown }]
      | undefined;
    expect(titleCall?.[0].schema).toBeDefined();
    expect(titleCall?.[0].model).toBeTypeOf('string');
    expect(titleCall?.[0].prompt).toEqual(expect.stringContaining('What happened?'));
    expect(fakes.fakeSetUniqueChatSessionTitle).toHaveBeenCalledWith(
      SESSION_ID,
      'Generated chat title',
      { touchUpdatedAt: false },
    );

    fakes.fakeSetUniqueChatSessionTitle.mockClear();
    await POST(request(validBody({ sessionId: SESSION_ID })));
    capturedOnFinish?.({
      text: 'Answer',
      toolCalls: [],
      finishReason: 'stop',
      usage: { inputTokens: 10, outputTokens: 5 },
    });
    await Promise.resolve();
    expect(fakes.fakeSetUniqueChatSessionTitle).not.toHaveBeenCalled();
  });

  it('retries titling an existing persisted session that still has no title', async () => {
    fakes.fakeChatSessionTitleStatus.mockResolvedValue({ exists: true, needsTitle: true });
    fakes.fakeSafeValidateUIMessages.mockResolvedValue({
      success: true,
      data: [userMessage, followUpMessage],
    });

    const response = await POST(
      request(validBody({ messages: [userMessage, followUpMessage], sessionId: SESSION_ID })),
    );

    expect(response.status).toBe(200);
    capturedOnFinish?.({
      text: 'Answer',
      toolCalls: [],
      finishReason: 'stop',
      usage: { inputTokens: 10, outputTokens: 5 },
    });
    await vi.waitFor(() => {
      expect(fakes.fakeSetUniqueChatSessionTitle).toHaveBeenCalledWith(
        SESSION_ID,
        'Generated chat title',
        { touchUpdatedAt: false },
      );
    });
    const titleCall = fakes.fakeChatStructured.mock.calls.at(0) as unknown as
      | [{ prompt?: unknown }]
      | undefined;
    expect(titleCall?.[0].prompt).toEqual(expect.stringContaining('What happened?'));
    expect(titleCall?.[0].prompt).not.toEqual(expect.stringContaining('What changed since then?'));
  });

  it('titles from the first user message with text when an earlier user message has no text', async () => {
    const nonTextMessage = {
      id: 'image-only',
      role: 'user',
      parts: [{ type: 'file', mediaType: 'image/png', url: 'https://example.test/image.png' }],
    };
    fakes.fakeChatSessionTitleStatus.mockResolvedValue({ exists: true, needsTitle: true });
    fakes.fakeSafeValidateUIMessages.mockResolvedValue({
      success: true,
      data: [nonTextMessage, followUpMessage],
    });

    const response = await POST(
      request(validBody({ messages: [nonTextMessage, followUpMessage], sessionId: SESSION_ID })),
    );

    expect(response.status).toBe(200);
    capturedOnFinish?.({
      text: 'Answer',
      toolCalls: [],
      finishReason: 'stop',
      usage: { inputTokens: 10, outputTokens: 5 },
    });
    await vi.waitFor(() => {
      expect(fakes.fakeSetUniqueChatSessionTitle).toHaveBeenCalledWith(
        SESSION_ID,
        'Generated chat title',
        { touchUpdatedAt: false },
      );
    });
    const titleCall = fakes.fakeChatStructured.mock.calls.at(0) as unknown as
      | [{ prompt?: unknown }]
      | undefined;
    expect(titleCall?.[0].prompt).toEqual(expect.stringContaining('What changed since then?'));
  });

  it('falls back to a sanitized first-message title when title generation fails', async () => {
    fakes.fakeChatStructured.mockRejectedValue(new Error('title model down'));

    await POST(request(validBody({ startNewSession: true })));
    capturedOnFinish?.({
      text: 'Answer',
      toolCalls: [],
      finishReason: 'stop',
      usage: { inputTokens: 10, outputTokens: 5 },
    });
    await vi.waitFor(() => {
      expect(fakes.fakeSetUniqueChatSessionTitle).toHaveBeenCalled();
    });

    expect(fakes.fakeSetUniqueChatSessionTitle).toHaveBeenCalledWith(SESSION_ID, 'What happened', {
      touchUpdatedAt: false,
    });
    const warnCall = fakes.fakeLoggerWarn.mock.calls.find(
      (call) => call[1] === 'chat title generation failed; using fallback',
    ) as unknown as [{ err?: unknown }, string] | undefined;
    expect(warnCall?.[0].err).toBeInstanceOf(Error);
  });

  it('truncates long unbroken fallback titles to the maximum length', async () => {
    const longText = 'x'.repeat(80);
    const longMessage = {
      id: 'long',
      role: 'user',
      parts: [{ type: 'text', text: longText }],
    };
    fakes.fakeSafeValidateUIMessages.mockResolvedValue({
      success: true,
      data: [longMessage],
    });
    fakes.fakeChatStructured.mockRejectedValue(new Error('title model down'));

    await POST(request(validBody({ messages: [longMessage], startNewSession: true })));
    capturedOnFinish?.({
      text: 'Answer',
      toolCalls: [],
      finishReason: 'stop',
      usage: { inputTokens: 10, outputTokens: 5 },
    });

    await vi.waitFor(() => {
      expect(fakes.fakeSetUniqueChatSessionTitle).toHaveBeenCalledWith(SESSION_ID, 'x'.repeat(48), {
        touchUpdatedAt: false,
      });
    });
  });

  it('does not title a new session when persisting the first turn fails', async () => {
    fakes.fakeAppendChatMessages.mockRejectedValue(new Error('append failed'));

    const response = await POST(request(validBody({ startNewSession: true })));

    expect(response.status).toBe(200);
    capturedOnFinish?.({
      text: 'Answer',
      toolCalls: [],
      finishReason: 'stop',
      usage: { inputTokens: 10, outputTokens: 5 },
    });
    await vi.waitFor(() => {
      expect(fakes.fakeLoggerWarn).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: SESSION_ID, teamId: TEAM_ID, userId: USER_ID }),
        'chat session append failed',
      );
    });

    expect(fakes.fakeSetUniqueChatSessionTitle).not.toHaveBeenCalled();
  });

  it('tolerates new-session creation and MCP discovery failures by streaming without persistence', async () => {
    fakes.fakeCreateChatSession.mockRejectedValue(new Error('bad pinned object'));
    fakes.fakeBuildMcpTools.mockRejectedValue(new Error('mcp down'));
    const sourceMessage = {
      id: 'm-source',
      role: 'user',
      parts: [{ type: 'text', text: 'Use the connected Slack source' }],
    };
    fakes.fakeSafeValidateUIMessages.mockResolvedValue({
      success: true,
      data: [sourceMessage],
    });

    const response = await POST(
      request(
        validBody({ messages: [sourceMessage], startNewSession: true, pinnedEntityId: PINNED_ID }),
      ),
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
    const expectedObservability = {
      toolObservations: [
        {
          tool: 'search_timeline',
          group: 'timeline',
          ok: true,
          durationMs: 3,
          inputKeys: ['query'],
          retrievalRecipe: { hasQuery: true, filters: [], limit: null, lookupKind: null },
          resultCount: 1,
          topArtifactRefs: [{ kind: 'timeline_event', id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' }],
          warningCodes: [],
        },
      ],
      selection: {
        selectedToolGroups: ['core', 'guide'],
        omittedToolGroups: [
          'objects',
          'boards',
          'documents',
          'calendar',
          'approvals',
          'actions',
          'integrations',
        ],
        selectedNativeToolCount: 1,
        omittedNativeToolCount: 0,
        mcpToolCount: 0,
        mcpDiscoverySkipped: true,
      },
      totalResultCount: 1,
      topArtifactRefs: [{ kind: 'timeline_event', id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' }],
      warningCodes: [],
    };
    fakes.fakeSummarizeAgentToolObservations.mockReturnValueOnce(expectedObservability);
    const response = await POST(request(validBody({ sessionId: SESSION_ID })));

    expect(response.status).toBe(200);
    expect(capturedOnFinish).toBeTypeOf('function');
    capturedOnFinish?.({
      text: 'Answer',
      toolCalls: [{ toolName: 'search_timeline' }],
      finishReason: 'stop',
      usage: { inputTokens: 10, outputTokens: 5 },
      model: { modelId: 'agent-model' },
      response: { modelId: 'fallback-agent-model' },
    });
    await Promise.resolve();

    expect(fakes.fakeAppendChatMessages).toHaveBeenCalledWith({}, expect.anything(), SESSION_ID, [
      { role: 'user', authorUserId: USER_ID, content: { ui_message: userMessage } },
      {
        role: 'assistant',
        content: {
          text: 'Answer',
          tool_calls: [{ toolName: 'search_timeline' }],
          tool_observability: expectedObservability,
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

  it('reports stream-time AI provider failures as handled telemetry events', async () => {
    const response = await POST(request(validBody({ sessionId: SESSION_ID })));

    expect(response.status).toBe(200);
    expect(capturedOnError).toBeTypeOf('function');
    capturedOnError?.({
      error: {
        timelineAi: true,
        operation: 'llm.streamChat',
        model: 'agent-model',
        causeName: 'AI_APICallError',
        causeMessage: 'OpenRouter 503 response body: [redacted]',
      },
    });

    expect(fakes.fakeReportCaughtError).not.toHaveBeenCalled();
    expect(fakes.fakeReportHandledEvent).toHaveBeenCalledWith({
      message: 'chat_stream_ai_provider_error',
      surface: 'api',
      operation: 'chat_stream',
      tags: {
        requestedModel: 'agent-model',
        fallbackModels: 'fallback-agent-model',
        reason: 'AI_APICallError',
        aiOperation: 'llm.streamChat',
        aiModel: 'agent-model',
        aiCauseName: 'AI_APICallError',
      },
    });
  });

  it('does not report client-aborted chat streams as provider failures', async () => {
    const response = await POST(request(validBody({ sessionId: SESSION_ID })));

    expect(response.status).toBe(200);
    expect(capturedOnError).toBeTypeOf('function');
    capturedOnError?.({
      error: {
        timelineAi: true,
        operation: 'llm.streamChat',
        model: 'agent-model',
        causeName: 'AbortError',
        causeMessage: 'This operation was aborted',
      },
    });

    expect(fakes.fakeReportCaughtError).not.toHaveBeenCalled();
    expect(fakes.fakeReportHandledEvent).not.toHaveBeenCalled();
  });
});
