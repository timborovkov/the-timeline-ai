import { type Db } from '@timeline/db';
import { type ModelMessage } from 'ai';

import { AGENT_PROMPT_VERSION, buildSystemPrompt } from '#src/agent/system-prompt.js';
import { buildAgentTools, type AgentToolErrorReporter } from '#src/agent/tools.js';
import { parseCitations } from '#src/citation.js';
import { getEnv } from '#src/env.js';
import {
  DEFAULT_AGENT_MAX_STEPS,
  streamChat,
  streamChatModelAttribution,
  type ChatDeps,
  type StreamChatModelAttribution,
} from '#src/llm/chat.js';
import { childLogger } from '#src/logger.js';
import { withTeam } from '#src/team-scope.js';
import { workspaceTimeContext } from '#src/time/index.js';

const log = childLogger('agent:ask');

/** Telegram's hard cap on a single message body. */
const TELEGRAM_MAX = 4096;
export const TEAM_BOT_ACTOR_USER_ID = '00000000-0000-0000-0000-000000000000';

export interface AskAgentInput {
  db: Db;
  teamId: string;
  userId: string;
  /** The user's question, already extracted from the `/ask` argument. */
  question: string;
  /** Display name for the system prompt. Falls back to "a teammate". */
  userName?: string;
  /** Trusted team-scoped bot actor. Keeps private/specific-user events invisible. */
  trustedTeamActor?: boolean | undefined;
  /** Cap on agent tool-call rounds. Defaults to `DEFAULT_AGENT_MAX_STEPS`. */
  maxSteps?: number;
}

export type AskAgentResult =
  | { ok: true; answer: string; truncated: boolean }
  | { ok: false; error: 'unconfigured' | 'not_a_member' | 'no_team' | 'failed' };

export interface AskAgentDeps extends ChatDeps {
  onToolError?: AgentToolErrorReporter | undefined;
  onAgentError?: ((err: unknown) => void) | undefined;
}

function stripMarkdownEmphasis(text: string): string {
  return text
    .replace(/(^|[^\w*])\*\*\*([^\n*]+?)\*\*\*(?=$|[^\w*])/g, '$1$2')
    .replace(/(^|[^\w*])\*\*([^\n*]+?)\*\*(?=$|[^\w*])/g, '$1$2')
    .replace(/(^|[^\w_])__([^\n_]+?)__(?=$|[^\w_])/g, '$1$2')
    .replace(/(^|[^\w*])\*([^\n*]+?)\*(?=$|[^\w*])/g, '$1$2')
    .replace(/(^|[^\w_])_([^\n_]+?)_(?=$|[^\w_])/g, '$1$2');
}

export function formatBotPlainTextAnswer(text: string): string {
  const withoutCitations = parseCitations(text)
    .flatMap((part) => (part.type === 'text' ? [part.value] : []))
    .join('');

  return stripMarkdownEmphasis(
    withoutCitations
      .replace(/\r\n?/g, '\n')
      .replace(/^```[^\n]*\n?/gm, '')
      .replace(/^```$/gm, '')
      .replace(/`([^`\n]+)`/g, '$1')
      .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
      .replace(/<([^>|]+)\|([^>]+)>/g, '$2 ($1)')
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/^>\s?/gm, ''),
  )
    .replace(/[ \t]+([.,!?;:])/g, '$1')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Non-streaming wrapper around the same agent pipeline `/api/chat` uses.
 * Built for surfaces that can't pipe an AI-SDK stream (Telegram, Slack, email,
 * cron) — collects the full text, strips web-chat citation/Markdown affordances
 * for plain bot messages, and returns it truncated to Telegram's 4096-char
 * message limit.
 *
 * Team isolation is enforced by the TeamScope (the agent tools never see a
 * teamId). The system prompt and prompt version match the web chat exactly,
 * so a Telegram answer is replayable against the same agent revision.
 */
export async function askAgent(
  input: AskAgentInput,
  deps: AskAgentDeps = {},
): Promise<AskAgentResult> {
  const env = getEnv();
  if (!env.OPENROUTER_API_KEY || !env.QDRANT_URL) {
    return { ok: false, error: 'unconfigured' };
  }

  const scope = withTeam(
    input.db,
    input.teamId,
    input.userId,
    input.trustedTeamActor ? { skipMembershipCheck: true } : {},
  );
  try {
    await scope.requireMembership();
  } catch {
    return { ok: false, error: 'not_a_member' };
  }

  const team = await scope.timeline.team();
  if (!team) return { ok: false, error: 'no_team' };
  const calendarSettings = await scope.calendar.getCalendarSettings();
  const currentUser = await scope.timeline.currentUserIdentityContext();
  const currentDate = new Date();

  const system = buildSystemPrompt({
    teamName: team.name,
    userName: input.userName ?? 'a teammate',
    currentUser,
    currentDate,
    workspaceTime: workspaceTimeContext(calendarSettings.defaultTimezone, currentDate),
  });
  const tools = buildAgentTools(scope, {
    onToolError: deps.onToolError,
    readOnly: input.trustedTeamActor,
  });

  const messages: ModelMessage[] = [{ role: 'user', content: input.question }];
  const modelAttribution: Partial<StreamChatModelAttribution> = {};

  try {
    const result = streamChat(
      {
        system,
        messages,
        tools,
        maxSteps: input.maxSteps ?? DEFAULT_AGENT_MAX_STEPS,
        onFinish: (event) => {
          Object.assign(modelAttribution, streamChatModelAttribution(event));
        },
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
        ...modelAttribution,
        chars: text.length,
      },
      'ask completion',
    );

    const trimmed = text.trim();
    if (trimmed.length === 0) {
      return { ok: false, error: 'failed' };
    }
    const plainAnswer = formatBotPlainTextAnswer(trimmed);
    if (plainAnswer.length === 0) {
      return { ok: false, error: 'failed' };
    }
    if (plainAnswer.length > TELEGRAM_MAX) {
      return {
        ok: true,
        answer: plainAnswer.slice(0, TELEGRAM_MAX - 1) + '…',
        truncated: true,
      };
    }
    return { ok: true, answer: plainAnswer, truncated: false };
  } catch (err) {
    log.error({ err, teamId: input.teamId }, 'askAgent failed');
    deps.onAgentError?.(err);
    return { ok: false, error: 'failed' };
  }
}
