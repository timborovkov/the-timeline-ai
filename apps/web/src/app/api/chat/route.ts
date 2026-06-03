import * as agent from '@timeline/shared/agent';
import { getEnv } from '@timeline/shared/env';
import * as llm from '@timeline/shared/llm';
import { childLogger } from '@timeline/shared/logger';
import * as objects from '@timeline/shared/objects';
import * as rateLimit from '@timeline/shared/rate-limit';
import { withTeam } from '@timeline/shared/team-scope';
import * as time from '@timeline/shared/time';
import { convertToModelMessages, safeValidateUIMessages, type UIMessage } from 'ai';
import { z } from 'zod';

import { resolveActiveTeam } from '@/lib/active-team';
import { trackProductEventBestEffort } from '@/lib/analytics';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { reportCaughtError } from '@/lib/sentry-report';

/**
 * Phase 6 — agent chat endpoint. Phase 8 wires session persistence on top.
 *
 * Node runtime: tools need DB + Qdrant + OpenRouter access, none of which run
 * on Edge. Per-team scope is constructed from the authenticated session +
 * the user's active team; the agent never sees a teamId, and tool input
 * schemas have no teamId field. Hostile inputs (cross-team event ids, alias
 * collisions) resolve to null at the SQL layer.
 *
 * Persistence (Phase 8): when the request includes `sessionId`, the
 * endpoint validates it belongs to the team and appends the latest user
 * turn + final assistant turn to `chat_messages` on `onFinish`. If
 * `sessionId` is absent, the endpoint auto-creates one and returns the new
 * id via the `x-tl-session-id` response header so the client can pin
 * subsequent turns to the same row.
 *
 * Returns 503 when OPENROUTER_API_KEY is unset so the UI can render
 * "chat unavailable" rather than throw — matches /api/search.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = childLogger('web:api:chat');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const chatRequestSchema = z.object({
  // Accept the structurally-validated UI messages from @ai-sdk/react useChat.
  // We re-validate before forwarding to the model.
  messages: z.array(z.unknown()).max(llm.DEFAULT_CHAT_MEMORY.maxRequestMessages),
  // Phase 8: optional persistence target. UUID-shape pre-checked here; the
  // scope helper re-verifies the session belongs to the team before write.
  sessionId: z.string().regex(UUID_RE).optional(),
  // Explicit opt-in to start a new persisted session. We intentionally do
  // NOT auto-create on bare requests: today's `useChat` UI re-POSTs the
  // full transcript every turn without a sessionId, so silent auto-create
  // would write one chat_sessions row per user message — useless data
  // until the sidebar UI starts pinning a session id. When the sidebar
  // lands it sends `startNewSession: true` on the first turn, receives the
  // new id via the `x-tl-session-id` response header, and echoes that
  // sessionId on subsequent turns. Until then, bare requests stream but
  // don't persist.
  startNewSession: z.boolean().optional(),
  // Optional object to pin a fresh session to (e.g. "ask about this deal"
  // from /app/objects/[id]). Only honored when startNewSession is true;
  // ignored otherwise. When sessionId is set, the session's existing
  // pinnedEntityId stays authoritative.
  pinnedEntityId: z.string().regex(UUID_RE).optional(),
});

function tokenUsage(usage: unknown): {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
} {
  if (!usage || typeof usage !== 'object') return {};
  const record = usage as Record<string, unknown>;
  const inputTokens =
    typeof record.inputTokens === 'number'
      ? record.inputTokens
      : typeof record.promptTokens === 'number'
        ? record.promptTokens
        : undefined;
  const outputTokens =
    typeof record.outputTokens === 'number'
      ? record.outputTokens
      : typeof record.completionTokens === 'number'
        ? record.completionTokens
        : undefined;
  const totalTokens = typeof record.totalTokens === 'number' ? record.totalTokens : undefined;
  return { inputTokens, outputTokens, totalTokens };
}

export async function POST(req: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ ok: false, error: 'unauthenticated' }, { status: 401 });
  }
  const env = getEnv();
  // Both keys are required: OpenRouter for the model, Qdrant for
  // search_timeline. Without Qdrant, the agent would call search_timeline,
  // hit a thrown getQdrantClient(), get back { error: 'tool_failed' }, then
  // retry until the step cap. Better to fail fast with a UI-readable error
  // — matches /api/search's gate exactly.
  if (!env.OPENROUTER_API_KEY || !env.QDRANT_URL) {
    return Response.json({ ok: false, error: 'chat_unconfigured' }, { status: 503 });
  }

  let parsedBody: unknown;
  try {
    parsedBody = await req.json();
  } catch {
    return Response.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }
  const parsed = chatRequestSchema.safeParse(parsedBody);
  if (!parsed.success) {
    return Response.json(
      { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid_input' },
      { status: 400 },
    );
  }

  // Also accept `?session=<uuid>` as a fallback so deep-linked clients that
  // can't yet propagate the sessionId in the request body still hit the
  // right persistence row. Body wins if both are set.
  if (!parsed.data.sessionId) {
    const querySessionId = new URL(req.url).searchParams.get('session');
    if (querySessionId && UUID_RE.test(querySessionId)) {
      parsed.data.sessionId = querySessionId;
    }
  }

  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) {
    return Response.json({ ok: false, error: 'no_active_team' }, { status: 400 });
  }

  const scope = withTeam(db, active.teamId, session.user.id);
  // requireMembership runs at first scope query, but check eagerly here so
  // a forged active-team cookie surfaces as 403 before we touch OpenRouter.
  try {
    await scope.requireMembership();
  } catch {
    return Response.json({ ok: false, error: 'not_a_member' }, { status: 403 });
  }

  const rl = await rateLimit.checkRateLimit({
    key: rateLimit.rateLimitKey('chat', 'user', session.user.id),
    ...rateLimit.RATE_LIMITS.aiChat,
  });
  if (!rl.ok) {
    return Response.json(
      { ok: false, error: 'rate_limited' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.retryAfterMs / 1000)) } },
    );
  }

  const team = await scope.timeline.team();
  const teamName = team?.name ?? active.teamName;
  const userName = session.user.name ?? session.user.email ?? 'a teammate';

  // Resolve the chat session, three cases:
  //   1. sessionId provided        → validate + persist into it.
  //   2. startNewSession: true     → create a new session, return id via header.
  //   3. neither                   → stream without persistence (UI hasn't
  //                                  opted into the session model yet).
  // See the schema comment above for why bare requests do NOT auto-create.
  let sessionId = parsed.data.sessionId;
  if (sessionId) {
    // Validate the session belongs to this team. 404 (not 403) is the
    // canonical "no resource here" — it doesn't distinguish "wrong team"
    // from "no such id," so cross-team session-id probing reveals nothing.
    // Cheap existence check — we only need to confirm team ownership here,
    // not load every prior message. `getChatSession` would pull the full
    // `chat_messages` list on every turn.
    const exists = await scope.objects.chatSessionExists(sessionId);
    if (!exists) {
      return Response.json({ ok: false, error: 'session_not_found' }, { status: 404 });
    }
  } else if (parsed.data.startNewSession) {
    try {
      const created = await scope.objects.createChatSession({
        pinnedEntityId: parsed.data.pinnedEntityId ?? null,
      });
      sessionId = created.id;
    } catch (err) {
      // Pinned object not in this team / bad uuid. Fall back to no
      // persistence rather than refuse the chat.
      log.warn({ err }, 'chat session create failed');
      reportCaughtError(err, { surface: 'api', operation: 'chat_session_create' });
    }
  }

  const calendarSettings = await scope.calendar.getCalendarSettings();
  const currentUser = await scope.timeline.currentUserIdentityContext();
  const currentDate = new Date();
  const system = agent.buildSystemPrompt({
    teamName,
    userName,
    currentUser,
    currentDate,
    workspaceTime: time.workspaceTimeContext(calendarSettings.defaultTimezone, currentDate),
  });
  // Phase 11 — merge any custom MCP tools the team has connected. The
  // MCP manager caches per-team for 5 min so this is cheap on hot paths.
  // Failures here (discovery failed, OAuth expired, server down) MUST
  // NOT crash the chat — but we log them so they show up in observability
  // instead of silently disappearing.
  const mcpTools = await agent.buildMcpTools(scope).catch((err: unknown) => {
    log.warn(
      { err, teamId: active.teamId },
      'mcp tool discovery failed; chat continues with native tools only',
    );
    reportCaughtError(err, { surface: 'api', operation: 'chat_mcp_tool_discovery' });
    return {};
  });
  const tools = { ...agent.buildAgentTools(scope), ...mcpTools };

  // Validate UIMessages BEFORE convertToModelMessages so a malformed client
  // (or attacker poking the endpoint) gets a clean 400 instead of an
  // unhandled rejection on the streaming path. The zod gate above only
  // checked "array with length <= 50"; this checks each message's shape.
  const validation = await safeValidateUIMessages<UIMessage>({
    messages: parsed.data.messages,
  });
  if (!validation.success) {
    return Response.json({ ok: false, error: 'invalid_messages' }, { status: 400 });
  }
  const uiMessages = validation.data;
  const messages = await convertToModelMessages(uiMessages);
  const modelId = llm.resolveAgentModelId();
  const memory = await llm.compressMessagesForContext({
    system,
    messages,
    model: () => llm.buildOpenRouterLanguageModel(llm.TIMELINE_MODELS.summarization.id),
    modelId,
    contextWindowTokens: llm.TIMELINE_MODELS.agent.contextWindowTokens,
  });
  if (memory.compressed) {
    log.info(
      {
        teamId: active.teamId,
        userId: session.user.id,
        sessionId: sessionId ?? null,
        estimatedTokens: memory.estimatedTokens,
        triggerTokens: memory.triggerTokens,
        keptMessages: memory.keptMessages,
        summarizedMessages: memory.summarizedMessages,
      },
      'chat history compressed',
    );
  }

  // The "latest user turn" is the trailing user message in the array. We
  // persist only the delta (this user turn + the new assistant turn),
  // because useChat re-sends the full transcript every request and the
  // earlier user turns were persisted on their respective calls.
  const latestUserMessage = [...uiMessages].reverse().find((m) => m.role === 'user') ?? null;
  trackProductEventBestEffort(session.user.id, 'chat_message_sent', {
    teamId: active.teamId,
    userId: session.user.id,
    sessionId: sessionId ?? null,
    persisted: Boolean(sessionId),
    messageCount: uiMessages.length,
  });

  const result = llm.streamChat({
    system,
    messages: memory.messages,
    tools,
    model: modelId,
    maxSteps: 5,
    // Propagate client disconnects to OpenRouter so we stop paying for
    // tokens nobody will see. Without this, a user navigating away mid-
    // stream still runs the model to completion.
    abortSignal: req.signal,
    onFinish: (e) => {
      log.info(
        {
          promptVersion: agent.AGENT_PROMPT_VERSION,
          teamId: active.teamId,
          userId: session.user.id,
          sessionId: sessionId ?? null,
          usage: e.usage,
        },
        'chat completion',
      );
      trackProductEventBestEffort(session.user.id, 'agent_answer_generated', {
        teamId: active.teamId,
        userId: session.user.id,
        sessionId: sessionId ?? null,
        persisted: Boolean(sessionId),
        modelId,
        toolCount: 'toolCalls' in e && Array.isArray(e.toolCalls) ? e.toolCalls.length : 0,
        promptVersion: agent.AGENT_PROMPT_VERSION,
        ...tokenUsage(e.usage),
      });
      if (!sessionId) return;
      // Persist after the stream resolves. Errors here must NOT crash the
      // response — the user already saw the assistant reply and a failed
      // append is recoverable next turn. Logged at warn so retries are
      // observable without paging.
      const turnsToPersist: objects.AppendChatMessageInput[] = [];
      if (latestUserMessage) {
        turnsToPersist.push({
          role: 'user',
          authorUserId: session.user.id,
          content: { ui_message: latestUserMessage },
        });
      }
      turnsToPersist.push({
        role: 'assistant',
        content: {
          text: 'text' in e && typeof e.text === 'string' ? e.text : null,
          tool_calls: 'toolCalls' in e ? e.toolCalls : undefined,
          finish_reason: 'finishReason' in e ? e.finishReason : undefined,
          usage: e.usage,
          prompt_version: agent.AGENT_PROMPT_VERSION,
        },
      });
      void objects
        .appendChatMessages(db, scope, sessionId, turnsToPersist)
        .catch((err: unknown) => {
          log.warn(
            { err, sessionId, teamId: active.teamId, userId: session.user.id },
            'chat session append failed',
          );
          reportCaughtError(err, { surface: 'background', operation: 'chat_session_append' });
        });
    },
  });

  const response = result.toUIMessageStreamResponse();
  // Surface the (possibly auto-created) session id so the client can pin
  // subsequent turns to this row. Header form is read-only metadata —
  // doesn't conflict with the AI-SDK stream body.
  if (sessionId) response.headers.set('x-tl-session-id', sessionId);
  return response;
}
