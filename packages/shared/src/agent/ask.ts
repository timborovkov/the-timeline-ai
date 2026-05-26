import { type Db } from '@timeline/db';
import { type ModelMessage } from 'ai';

import { getEnv } from '../env.js';
import { streamChat, type ChatDeps } from '../llm/chat.js';
import { childLogger } from '../logger.js';
import { withTeam } from '../team-scope.js';

import { AGENT_PROMPT_VERSION, buildSystemPrompt } from './system-prompt.js';
import { buildAgentTools } from './tools.js';

const log = childLogger('agent:ask');

/** Telegram's hard cap on a single message body. */
const TELEGRAM_MAX = 4096;

export interface AskAgentInput {
  db: Db;
  teamId: string;
  userId: string;
  /** The user's question, already extracted from the `/ask` argument. */
  question: string;
  /** Display name for the system prompt. Falls back to "a teammate". */
  userName?: string;
  /** Cap on agent tool-call rounds. Default 5 (matches /api/chat). */
  maxSteps?: number;
}

export type AskAgentResult =
  | { ok: true; answer: string; truncated: boolean }
  | { ok: false; error: 'unconfigured' | 'not_a_member' | 'no_team' | 'failed' };

/**
 * Non-streaming wrapper around the same agent pipeline `/api/chat` uses.
 * Built for surfaces that can't pipe an AI-SDK stream (Telegram, email, cron) —
 * collects the full text and returns it, truncated to Telegram's 4096-char
 * message limit.
 *
 * Team isolation is enforced by the TeamScope (the agent tools never see a
 * teamId). The system prompt and prompt version match the web chat exactly,
 * so a Telegram answer is replayable against the same agent revision.
 */
export async function askAgent(input: AskAgentInput, deps: ChatDeps = {}): Promise<AskAgentResult> {
  const env = getEnv();
  if (!env.OPENROUTER_API_KEY || !env.QDRANT_URL) {
    return { ok: false, error: 'unconfigured' };
  }

  const scope = withTeam(input.db, input.teamId, input.userId);
  try {
    await scope.requireMembership();
  } catch {
    return { ok: false, error: 'not_a_member' };
  }

  const team = await scope.timeline.team();
  if (!team) return { ok: false, error: 'no_team' };

  const system = buildSystemPrompt({
    teamName: team.name,
    userName: input.userName ?? 'a teammate',
    currentDate: new Date(),
  });
  const tools = buildAgentTools(scope);

  const messages: ModelMessage[] = [{ role: 'user', content: input.question }];

  try {
    const result = streamChat(
      {
        system,
        messages,
        tools,
        maxSteps: input.maxSteps ?? 5,
      },
      deps,
    );
    // `.text` resolves to the final assistant text after all tool rounds; we
    // intentionally do NOT need the streamed chunks because Telegram can't
    // render them progressively.
    const text = await result.text;
    log.info(
      {
        promptVersion: AGENT_PROMPT_VERSION,
        teamId: input.teamId,
        userId: input.userId,
        chars: text.length,
      },
      'ask completion',
    );

    const trimmed = text.trim();
    if (trimmed.length === 0) {
      return { ok: false, error: 'failed' };
    }
    if (trimmed.length > TELEGRAM_MAX) {
      return {
        ok: true,
        answer: trimmed.slice(0, TELEGRAM_MAX - 1) + '…',
        truncated: true,
      };
    }
    return { ok: true, answer: trimmed, truncated: false };
  } catch (err) {
    log.error({ err, teamId: input.teamId }, 'askAgent failed');
    return { ok: false, error: 'failed' };
  }
}
