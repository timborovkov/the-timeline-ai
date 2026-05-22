import { agent, childLogger, getEnv, llm, withTeam } from '@timeline/shared';
import { convertToModelMessages, safeValidateUIMessages, type UIMessage } from 'ai';
import { z } from 'zod';

import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

/**
 * Phase 6 — agent chat endpoint.
 *
 * Node runtime: tools need DB + Qdrant + OpenRouter access, none of which run
 * on Edge. Per-team scope is constructed from the authenticated session +
 * the user's active team; the agent never sees a teamId, and tool input
 * schemas have no teamId field. Hostile inputs (cross-team event ids, alias
 * collisions) resolve to null at the SQL layer.
 *
 * Returns 503 when OPENROUTER_API_KEY is unset so the UI can render
 * "chat unavailable" rather than throw — matches /api/search.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = childLogger('web:api:chat');

const chatRequestSchema = z.object({
  // Accept the structurally-validated UI messages from @ai-sdk/react useChat.
  // We re-validate before forwarding to the model.
  messages: z.array(z.unknown()).max(50),
});

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

  const team = await scope.team();
  const teamName = team?.name ?? active.teamName;
  const userName = session.user.name ?? session.user.email ?? 'a teammate';

  const system = agent.buildSystemPrompt({
    teamName,
    userName,
    currentDate: new Date(),
  });
  const tools = agent.buildAgentTools(scope);

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
  const messages = await convertToModelMessages(validation.data);

  const result = llm.streamChat({
    system,
    messages,
    tools,
    maxSteps: 5,
    onFinish: (e) => {
      // Stamp the prompt version on every completion. If a captured
      // conversation is ever persisted, this version pins which agent
      // produced it — same audit logic as Phase 4's model_version stamp
      // on extracted facts.
      log.info(
        {
          promptVersion: agent.AGENT_PROMPT_VERSION,
          teamId: active.teamId,
          userId: session.user.id,
          usage: e.usage,
        },
        'chat completion',
      );
    },
  });

  return result.toUIMessageStreamResponse();
}
