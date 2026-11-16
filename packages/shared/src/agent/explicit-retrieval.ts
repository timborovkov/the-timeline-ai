import { eventSource, integrationProvider } from '@timeline/db';

type IntegrationProvider = Exclude<(typeof integrationProvider.enumValues)[number], 'mcp'>;
type EventSource = (typeof eventSource.enumValues)[number];

export interface ExplicitRetrievalRequest {
  tool: string;
  input: Record<string, unknown>;
}

const EXPLICIT_RETRIEVAL_TOOL_NAMES = [
  'list_tasks',
  'list_calendar_events',
  'search_integration_events',
  'get_integration_resource',
  'search_documents',
  'search_timeline',
] as const;

const INTEGRATION_PROVIDERS = integrationProvider.enumValues
  .filter((provider) => provider !== 'mcp')
  .join('|');

function providerNear(question: string, toolName: string): IntegrationProvider | undefined {
  const localArgs = toolLocalArgs(question, toolName);
  if (localArgs === undefined) return undefined;
  const match = new RegExp(
    `\\bprovider\\s*(?::|=|\\bwith)?\\s*(${INTEGRATION_PROVIDERS})\\b`,
    'i',
  ).exec(localArgs);
  return match?.[1]?.toLowerCase() as IntegrationProvider | undefined;
}

function externalObjectIdNear(question: string, toolName: string): string | undefined {
  const localArgs = toolLocalArgs(question, toolName);
  if (localArgs === undefined) return undefined;
  return /\bexternalObjectId\s*(?::|=|\b(?:is|of))?\s*([^\s,.;]+)/i.exec(localArgs)?.[1];
}

function toolLocalArgs(question: string, toolName: string): string | undefined {
  const start = question.toLowerCase().indexOf(toolName);
  if (start === -1) return undefined;
  const tail = question.slice(start + toolName.length);
  const nextTool = EXPLICIT_RETRIEVAL_TOOL_NAMES.reduce((nearest, name) => {
    const index = tail.toLowerCase().indexOf(name);
    return index >= 0 && index < nearest ? index : nearest;
  }, tail.length);
  return tail.slice(0, nextTool);
}

/**
 * Parse source and query words only from the named search_timeline clause.
 * A whole multi-tool instruction is a poor semantic-search query: it includes
 * unrelated tool names and may make a source-filtered preflight miss its hit.
 */
function searchTimelineArgsNear(
  question: string,
  toolName: string,
): { query: string; source?: EventSource } {
  const localArgs = toolLocalArgs(question, toolName);
  if (!localArgs) return { query: question };

  const sourceMatch = new RegExp(
    `\\bsource\\s*(?::|=|\\bwith)?\\s*(${eventSource.enumValues.join('|')})\\b`,
    'i',
  ).exec(localArgs);
  const source = sourceMatch?.[1]?.toLowerCase() as EventSource | undefined;
  // Keep terms attached with an explicit retrieval qualifier. Do not treat the
  // follow-up question as a tool argument, because it can contain unrelated
  // synthesis instructions or hostile external-content wording.
  const contextualQuery = sourceMatch
    ? /\s+(?:for|about|regarding)\s+([^,.;!?]+)/i
        .exec(localArgs.slice(sourceMatch.index + sourceMatch[0].length))?.[1]
        ?.trim()
        .replace(/^(?:the|a|an)\s+/i, '')
    : undefined;

  return {
    query: contextualQuery ?? question,
    ...(source ? { source } : {}),
  };
}

/**
 * Parse an explicit Timeline retrieval checklist into executable, bounded
 * reads. This deliberately requires "Timeline tool(s)" wording so ordinary
 * natural-language questions retain model-directed retrieval behavior.
 */
export function parseExplicitRetrievalContract(question: string): ExplicitRetrievalRequest[] {
  if (!/\buse\b[\s\S]*\bTimeline tools?\b/i.test(question)) return [];

  const requested = new Set<string>();
  for (const tool of EXPLICIT_RETRIEVAL_TOOL_NAMES) {
    if (question.toLowerCase().includes(tool)) requested.add(tool);
  }
  // Source-surface wording is also a contract, even if the caller did not
  // know the implementation tool name.
  if (/\btasks?\b/i.test(question)) requested.add('list_tasks');
  if (/\bcalendar\b/i.test(question)) requested.add('list_calendar_events');
  if (/\bdocuments?\b/i.test(question)) requested.add('search_documents');
  if (new RegExp(`\\b(${INTEGRATION_PROVIDERS})\\b`, 'i').test(question)) {
    requested.add('search_integration_events');
  }

  return EXPLICIT_RETRIEVAL_TOOL_NAMES.flatMap<ExplicitRetrievalRequest>((tool) => {
    if (!requested.has(tool)) return [];
    if (tool === 'search_integration_events') {
      const provider = providerNear(question, tool);
      return [{ tool, input: { query: question, ...(provider ? { provider } : {}) } }];
    }
    if (tool === 'get_integration_resource') {
      const provider = providerNear(question, tool);
      const externalObjectId = externalObjectIdNear(question, tool);
      // Do not invent a provider/object id. The model can ask for the missing
      // detail, while all complete explicit requests are guaranteed a read.
      return provider && externalObjectId ? [{ tool, input: { provider, externalObjectId } }] : [];
    }
    if (tool === 'search_timeline') {
      return [{ tool, input: searchTimelineArgsNear(question, tool) }];
    }
    if (tool === 'search_documents') {
      return [{ tool, input: { query: question } }];
    }
    return [{ tool, input: {} }];
  });
}

export function selectExplicitlyRequestedNativeTools<T extends Record<string, unknown>>(
  question: string,
  nativeTools: T,
): T {
  const contract = parseExplicitRetrievalContract(question);
  if (contract.length === 0) return nativeTools;
  const selected = contract.flatMap(({ tool }) =>
    tool in nativeTools ? [[tool, nativeTools[tool]]] : [],
  );
  return Object.fromEntries(selected) as T;
}
