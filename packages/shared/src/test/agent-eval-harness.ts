import { MockLanguageModelV3 } from 'ai/test';

import type { AgentTurnObservability } from '#src/agent/observability.js';
import type { EmbedResult } from '#src/llm/embed.js';
import type { SearchHit } from '#src/qdrant/client.js';
import type { LanguageModel } from 'ai';

import {
  askAgent,
  type AskAgentDeps,
  type AskAgentInput,
  type AskAgentResult,
} from '#src/agent/ask.js';
import { buildAgentTools } from '#src/agent/tools.js';
import { withTeam } from '#src/team-scope.js';

type HitSource = SearchHit['payload']['source'];

export type AgentEvalToolName =
  | 'search_timeline'
  | 'search_timeline_moments'
  | 'search_integration_events'
  | 'search_documents'
  | 'list_tasks'
  | 'list_objects'
  | 'list_calendar_events'
  | 'list_team_members';

interface AgentEvalTraceEntry {
  tool: AgentEvalToolName;
  input: unknown;
  output: unknown;
}

export interface AgentEvalRun {
  output: unknown;
  trace: AgentEvalTraceEntry[];
  answer: string;
}

export interface AskAgentEvalRun {
  result: AskAgentResult;
  turnObservability: AgentTurnObservability[];
}

export interface BuildSearchHitInput {
  teamId: string;
  id?: string;
  eventId: string;
  score: number;
  authorUserId: string | null;
  visibilityOwnerUserId: string | null;
  factId?: string | null;
  source?: HitSource;
  sourceKind?: SearchHit['payload']['source_kind'];
  sourceScope?: SearchHit['payload']['source_scope'];
  sourceId?: string;
  occurredAt?: string;
  overrides?: Partial<SearchHit['payload']>;
}

export function buildSearchHit(input: BuildSearchHitInput): SearchHit {
  return {
    id: input.id ?? input.eventId,
    score: input.score,
    payload: {
      team_id: input.teamId,
      source_kind: input.sourceKind ?? 'raw_event',
      event_id: input.eventId,
      fact_id: input.factId ?? null,
      object_id: null,
      note_id: null,
      change_id: null,
      entity_id: null,
      entity_ids: [],
      source: input.source ?? 'web',
      occurred_at: input.occurredAt ?? '2026-06-01T09:00:00.000Z',
      author_user_id: input.authorUserId,
      visibility: 'team',
      visibility_user_ids: null,
      visibility_owner_user_id: input.visibilityOwnerUserId,
      embedding_model: 'eval-embedding-model',
      source_scope: input.sourceScope ?? 'event',
      source_id: input.sourceId ?? input.eventId,
      chunk_index: 0,
      document_id: null,
      document_version_id: null,
      document_chunk_id: null,
      folder_id: null,
      owner_user_id: null,
      updated_at: null,
      meeting_id: null,
      meeting_chunk_id: null,
      speaker: null,
      ...input.overrides,
    },
  };
}

export function buildDocumentSearchHit(input: {
  teamId: string;
  chunkId: string;
  documentId: string;
  documentVersionId: string;
  score: number;
  authorUserId: string | null;
  visibilityOwnerUserId: string | null;
  occurredAt?: string;
  overrides?: Partial<SearchHit['payload']>;
}): SearchHit {
  return buildSearchHit({
    teamId: input.teamId,
    eventId: input.chunkId,
    score: input.score,
    authorUserId: input.authorUserId,
    visibilityOwnerUserId: input.visibilityOwnerUserId,
    source: 'document',
    sourceKind: 'doc_chunk',
    sourceScope: 'doc_chunk',
    sourceId: input.chunkId,
    ...(input.occurredAt ? { occurredAt: input.occurredAt } : {}),
    overrides: {
      event_id: null,
      fact_id: null,
      document_id: input.documentId,
      document_version_id: input.documentVersionId,
      document_chunk_id: input.chunkId,
      ...input.overrides,
    },
  });
}

export function buildMeetingSearchHit(input: {
  teamId: string;
  id?: string;
  eventId: string;
  meetingId: string;
  meetingChunkId: string;
  score: number;
  authorUserId: string | null;
  visibilityOwnerUserId: string | null;
  speaker?: string | null;
  occurredAt?: string;
  overrides?: Partial<SearchHit['payload']>;
}): SearchHit {
  return buildSearchHit({
    teamId: input.teamId,
    ...(input.id ? { id: input.id } : {}),
    eventId: input.eventId,
    score: input.score,
    authorUserId: input.authorUserId,
    visibilityOwnerUserId: input.visibilityOwnerUserId,
    source: 'meeting',
    sourceKind: 'meeting_chunk',
    sourceScope: 'meeting_chunk',
    sourceId: input.meetingChunkId,
    occurredAt: input.occurredAt ?? '2026-06-02T14:00:00.000Z',
    overrides: {
      meeting_id: input.meetingId,
      meeting_chunk_id: input.meetingChunkId,
      speaker: input.speaker ?? null,
      ...input.overrides,
    },
  });
}

export async function runAgentToolEval(input: {
  db: Parameters<typeof withTeam>[0];
  teamId: string;
  userId: string;
  toolName: AgentEvalToolName;
  toolInput: unknown;
  hits?: SearchHit[];
  embed?: (input: { text: string }) => Promise<EmbedResult>;
}): Promise<AgentEvalRun> {
  const trace: AgentEvalTraceEntry[] = [];
  const scope = withTeam(input.db, input.teamId, input.userId, {
    embed:
      input.embed ??
      (({ text }): Promise<EmbedResult> =>
        Promise.resolve({
          vector: text.includes('Acme') ? [0.9, 0.1, 0.1] : [0.1, 0.1, 0.1],
          model: 'eval-embed',
        })),
    qdrantSearch: () => Promise.resolve(input.hits ?? []),
  });
  const tools = buildAgentTools(scope);
  const exec = tools[input.toolName]?.execute as (raw: unknown, opts: unknown) => Promise<unknown>;
  const output = await exec(input.toolInput, {});
  trace.push({ tool: input.toolName, input: input.toolInput, output });
  return {
    output,
    trace,
    answer: answerFromToolResult(input.toolName, output),
  };
}

export async function runAskAgentEval(
  input: AskAgentInput,
  deps: AskAgentDeps = {},
): Promise<AskAgentEvalRun> {
  const turnObservability: AgentTurnObservability[] = [];
  const result = await askAgent(input, {
    ...deps,
    onTurnObservability: (observability) => {
      turnObservability.push(observability);
      deps.onTurnObservability?.(observability);
    },
  });
  return { result, turnObservability };
}

export function makeAskAgentTextModel(
  text: string,
  capture?: (opts: unknown) => void,
): LanguageModel {
  return new MockLanguageModelV3({
    doStream: ((opts: unknown) => {
      capture?.(opts);
      return Promise.resolve({
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: 'text-start', id: '1' });
            if (text.length > 0) controller.enqueue({ type: 'text-delta', id: '1', delta: text });
            controller.enqueue({ type: 'text-end', id: '1' });
            controller.enqueue({
              type: 'finish',
              finishReason: 'stop',
              usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
            });
            controller.close();
          },
        }),
      });
    }) as never,
  });
}

export function makeFailingAskAgentModel(): LanguageModel {
  return new MockLanguageModelV3({
    doStream: (() => Promise.reject(new Error('model down'))) as never,
  });
}

export function makeAskAgentToolRoundModel(input: {
  toolName: string;
  toolInput: Record<string, unknown>;
  answer: string;
  capture?: (opts: unknown) => void;
}): LanguageModel {
  let call = 0;
  return new MockLanguageModelV3({
    doStream: ((opts: unknown) => {
      input.capture?.(opts);
      call += 1;
      return Promise.resolve({
        stream: new ReadableStream({
          start(controller) {
            if (call === 1) {
              controller.enqueue({
                type: 'tool-call',
                toolCallId: 'call-eval-1',
                toolName: input.toolName,
                input: JSON.stringify(input.toolInput),
              });
              controller.enqueue({
                type: 'finish',
                finishReason: 'tool-calls',
                usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
              });
            } else {
              controller.enqueue({ type: 'text-start', id: 'answer-1' });
              controller.enqueue({ type: 'text-delta', id: 'answer-1', delta: input.answer });
              controller.enqueue({ type: 'text-end', id: 'answer-1' });
              controller.enqueue({
                type: 'finish',
                finishReason: 'stop',
                usage: { inputTokens: 2, outputTokens: 1, totalTokens: 3 },
              });
            }
            controller.close();
          },
        }),
      });
    }) as never,
  });
}

export function answerFromToolResult(name: AgentEvalToolName, result: unknown): string {
  if (name === 'search_timeline') return answerFromTimeline(result);
  if (name === 'search_timeline_moments') return answerFromMoments(result);
  if (name === 'search_integration_events') return answerFromIntegrationEvents(result);
  if (name === 'search_documents') return answerFromDocuments(result);
  return '';
}

function answerFromTimeline(result: unknown): string {
  const rows = (result as { results?: { eventId: string; snippet: string }[] }).results ?? [];
  if (rows.length === 0) return "I couldn't verify that from the accessible timeline.";
  return rows.map((row) => `${row.snippet} [event:${row.eventId}]`).join('\n');
}

function answerFromMoments(result: unknown): string {
  const rows =
    (
      result as {
        moments?: { title: string; raw_event_ids: string[]; evidence_count: number }[];
      }
    ).moments ?? [];
  if (rows.length === 0) return "I couldn't verify that from accessible timeline moments.";
  return rows
    .map(
      (row) =>
        `${row.title} (${String(row.evidence_count)} events) ${row.raw_event_ids
          .map((id) => `[event:${id}]`)
          .join(' ')}`,
    )
    .join('\n');
}

function answerFromIntegrationEvents(result: unknown): string {
  const rows =
    (
      result as {
        results?: { event_id: string; snippet: string }[];
      }
    ).results ?? [];
  if (rows.length === 0) return "I couldn't verify that from synced integrations.";
  return rows.map((row) => `${row.snippet} [event:${row.event_id}]`).join('\n');
}

function answerFromDocuments(result: unknown): string {
  const rows =
    (
      result as {
        results?: { citation: string; document_name: string; snippet: string }[];
      }
    ).results ?? [];
  if (rows.length === 0) return "I couldn't verify that from searchable documents.";
  return rows.map((row) => `${row.document_name}: ${row.snippet} ${row.citation}`).join('\n');
}
