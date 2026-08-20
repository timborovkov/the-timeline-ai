import type { ToolSet } from 'ai';

import { citationPartToArtifactRef, parseCitations, type ArtifactRef } from '#src/citation.js';

export type AgentToolGroup =
  | 'timeline'
  | 'timeline_moment'
  | 'object'
  | 'board'
  | 'calendar'
  | 'document'
  | 'approval'
  | 'integration'
  | 'mcp'
  | 'app_guide'
  | 'mutation'
  | 'other';

export interface AgentRetrievalRecipe {
  hasQuery: boolean;
  filters: string[];
  limit: number | null;
  lookupKind: string | null;
}

export interface AgentToolObservation {
  tool: string;
  group: AgentToolGroup;
  ok: boolean;
  durationMs: number;
  inputKeys: string[];
  retrievalRecipe: AgentRetrievalRecipe | null;
  resultCount: number | null;
  topArtifactRefs: ArtifactRef[];
  proposalIds: string[];
  warningCodes: string[];
}

export interface AgentToolSelectionObservability {
  selectedToolGroups: string[];
  omittedToolGroups: string[];
  selectedNativeToolCount: number;
  omittedNativeToolCount: number;
  mcpToolCount: number;
  mcpDiscoverySkipped: boolean;
}

export interface AgentTurnObservability {
  toolObservations: AgentToolObservation[];
  selection: AgentToolSelectionObservability | null;
  totalResultCount: number;
  topArtifactRefs: ArtifactRef[];
  proposalIds: string[];
  warningCodes: string[];
}

interface ExecutableTool {
  execute?: (...args: unknown[]) => unknown;
}

const RESULT_ARRAY_KEYS = [
  'results',
  'events',
  'moments',
  'objects',
  'items',
  'tasks',
  'documents',
  'chunks',
  'approvals',
  'members',
  'boards',
  'rows',
] as const;

const RECIPE_FILTER_KEYS = [
  'from',
  'to',
  'source',
  'sourceKind',
  'provider',
  'externalObjectId',
  'documentId',
  'folderIds',
  'objectId',
  'entityIds',
  'personObjectId',
  'senderHandle',
  'senderSource',
] as const;

export function instrumentAgentTools<TTools extends ToolSet>(
  tools: TTools,
  onObservation: (observation: AgentToolObservation) => void,
): TTools {
  const out: Record<string, unknown> = {};
  for (const [name, definition] of Object.entries(tools)) {
    const executable = definition as ExecutableTool;
    if (typeof executable.execute !== 'function') {
      out[name] = definition;
      continue;
    }
    const original = executable.execute;
    out[name] = {
      ...definition,
      execute: async (...args: unknown[]) => {
        const started = Date.now();
        try {
          const output = await original(...args);
          onObservation(buildToolObservation(name, args[0], output, Date.now() - started));
          return output;
        } catch (err) {
          onObservation(
            buildToolObservation(name, args[0], { error: 'thrown' }, Date.now() - started),
          );
          throw err;
        }
      },
    };
  }
  return out as TTools;
}

export function summarizeAgentToolObservations(input: {
  observations: AgentToolObservation[];
  selection?: AgentToolSelectionObservability | null;
}): AgentTurnObservability {
  const topArtifactRefs = uniqueArtifactRefs(
    input.observations.flatMap((observation) => observation.topArtifactRefs),
  ).slice(0, 10);
  const warningCodes = [...new Set(input.observations.flatMap((row) => row.warningCodes))].sort();
  const proposalIds = [...new Set(input.observations.flatMap((row) => row.proposalIds))];
  return {
    toolObservations: input.observations,
    selection: input.selection ?? null,
    totalResultCount: input.observations.reduce(
      (sum, row) => sum + (typeof row.resultCount === 'number' ? row.resultCount : 0),
      0,
    ),
    topArtifactRefs,
    proposalIds,
    warningCodes,
  };
}

export function agentToolGroup(toolName: string): AgentToolGroup {
  if (toolName.startsWith('mcp__')) return 'mcp';
  if (toolName.startsWith('execute_')) return 'mutation';
  if (toolName === 'revise_suggestion') return 'approval';
  if (toolName.includes('timeline_moment')) return 'timeline_moment';
  if (toolName.includes('timeline') || toolName.includes('event')) return 'timeline';
  if (toolName.includes('object') || toolName.includes('entity')) return 'object';
  if (toolName.includes('board')) return 'board';
  if (toolName.includes('calendar')) return 'calendar';
  if (toolName.includes('document')) return 'document';
  if (toolName.includes('approval') || toolName.startsWith('suggest_')) return 'approval';
  if (toolName.includes('integration')) return 'integration';
  if (toolName.includes('app_') || toolName.includes('route')) return 'app_guide';
  return 'other';
}

function buildToolObservation(
  toolName: string,
  input: unknown,
  output: unknown,
  durationMs: number,
): AgentToolObservation {
  return {
    tool: toolName,
    group: agentToolGroup(toolName),
    ok: !hasError(output),
    durationMs,
    inputKeys: inputKeys(input),
    retrievalRecipe: retrievalRecipe(input),
    resultCount: resultCount(output),
    topArtifactRefs: extractArtifactRefs(output).slice(0, 10),
    proposalIds: extractProposalIds(toolName, output),
    warningCodes: warningCodes(output),
  };
}

const PROPOSAL_TOOL_NAMES = new Set([
  'suggest_task',
  'propose_object_change',
  'suggest_object_memory',
  'suggest_calendar_event',
  'propose_calendar_update',
]);

function extractProposalIds(toolName: string, output: unknown): string[] {
  if (!PROPOSAL_TOOL_NAMES.has(toolName)) return [];
  const row = objectRecord(output);
  if (!row || row.ok === false) return [];
  const id = typeof row.suggestion_id === 'string' ? row.suggestion_id : row.id;
  return typeof id === 'string' ? [id] : [];
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function inputKeys(input: unknown): string[] {
  const row = objectRecord(input);
  if (!row) return [];
  return Object.keys(row).sort((a, b) => a.localeCompare(b));
}

function retrievalRecipe(input: unknown): AgentRetrievalRecipe | null {
  const row = objectRecord(input);
  if (!row) return null;
  const hasQuery = typeof row.query === 'string' && row.query.trim().length > 0;
  const filters = RECIPE_FILTER_KEYS.filter((key) => row[key] !== undefined);
  const limit = typeof row.limit === 'number' && Number.isFinite(row.limit) ? row.limit : null;
  const lookupKind =
    typeof row.id === 'string'
      ? 'id'
      : typeof row.idOrName === 'string'
        ? 'id_or_name'
        : typeof row.momentId === 'string'
          ? 'moment_id'
          : null;
  if (!hasQuery && filters.length === 0 && limit === null && lookupKind === null) return null;
  return { hasQuery, filters, limit, lookupKind };
}

function resultCount(output: unknown): number | null {
  if (Array.isArray(output)) return output.length;
  const row = objectRecord(output);
  if (!row) return null;
  for (const key of RESULT_ARRAY_KEYS) {
    const value = row[key];
    if (Array.isArray(value)) return value.length;
  }
  if (typeof row.count === 'number' && Number.isFinite(row.count)) return row.count;
  if (row.ok === true || row.id || row.citation) return 1;
  return null;
}

function hasError(output: unknown): boolean {
  const row = objectRecord(output);
  if (!row) return false;
  return row.ok === false || typeof row.error === 'string';
}

function warningCodes(output: unknown): string[] {
  const warnings = new Set<string>();
  collectWarnings(output, warnings, 0);
  return [...warnings].sort();
}

function collectWarnings(value: unknown, warnings: Set<string>, depth: number): void {
  if (depth > 5 || warnings.size >= 20) return;
  if (Array.isArray(value)) {
    for (const item of value) collectWarnings(item, warnings, depth + 1);
    return;
  }
  const row = objectRecord(value);
  if (!row) return;
  for (const [key, child] of Object.entries(row)) {
    const lowerKey = key.toLowerCase();
    if (
      (lowerKey.includes('warning') ||
        lowerKey.includes('error') ||
        lowerKey.includes('degraded') ||
        lowerKey.includes('reauth') ||
        lowerKey.includes('approval')) &&
      (typeof child === 'string' || typeof child === 'boolean')
    ) {
      warnings.add(`${key}:${String(child)}`);
    }
    collectWarnings(child, warnings, depth + 1);
  }
}

function extractArtifactRefs(output: unknown): ArtifactRef[] {
  const refs: ArtifactRef[] = [];
  collectArtifactRefs(output, refs, 0);
  return uniqueArtifactRefs(refs);
}

function collectArtifactRefs(value: unknown, refs: ArtifactRef[], depth: number): void {
  if (depth > 6 || refs.length >= 50) return;
  if (typeof value === 'string') {
    refs.push(
      ...parseCitations(value)
        .filter((part) => part.type !== 'text')
        .map((part) => citationPartToArtifactRef(part)),
    );
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectArtifactRefs(item, refs, depth + 1);
    return;
  }
  const row = objectRecord(value);
  if (!row) return;
  for (const child of Object.values(row)) collectArtifactRefs(child, refs, depth + 1);
}

function uniqueArtifactRefs(refs: ArtifactRef[]): ArtifactRef[] {
  const seen = new Set<string>();
  const out: ArtifactRef[] = [];
  for (const ref of refs) {
    const key = JSON.stringify(ref);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ref);
  }
  return out;
}
