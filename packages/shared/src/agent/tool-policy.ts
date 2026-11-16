import type { ToolSet } from 'ai';

const TOOL_POLICY = Symbol('timeline.toolPolicy');

type PolicyTool = ToolSet[string] & { [TOOL_POLICY]?: AgentToolPolicy };

export function userApprovalForTools(tools: ToolSet): Record<string, 'user-approval'> | undefined {
  const approval: Record<string, 'user-approval'> = {};
  for (const [name, definition] of Object.entries(tools)) {
    const policy = definition as PolicyTool;
    if (policy[TOOL_POLICY]?.userApproval === 'required') approval[name] = 'user-approval';
  }
  return Object.keys(approval).length > 0 ? approval : undefined;
}

export type AgentToolMode = 'full' | 'proposal_only' | 'read_only';

type AgentToolCapability = 'read' | 'proposal' | 'mutation' | 'pin_read' | 'pin_mutation';

export interface CapabilityTool {
  capability: AgentToolCapability;
  definition: ToolSet[string];
}

type AgentToolPolicy =
  | { capability: 'mutation'; userApproval: 'required' | 'none' }
  | { capability: Exclude<AgentToolCapability, 'mutation'>; userApproval?: never };

export function capabilityTool(input: ToolSet[string] & AgentToolPolicy): CapabilityTool {
  const { capability, userApproval, ...definition } = input;
  const policy: AgentToolPolicy =
    capability === 'mutation' ? { capability, userApproval } : { capability };
  // Enumerable symbols survive instrumentation's object spread, but cannot
  // leak into the provider's JSON schema or become model-controlled input.
  const definitionWithPolicy = { ...definition, [TOOL_POLICY]: policy };
  return { capability, definition: definitionWithPolicy };
}

export function capabilityAllowed(
  capability: AgentToolCapability,
  options: {
    toolMode?: AgentToolMode | undefined;
    allowPinMutations?: boolean | undefined;
  },
): boolean {
  if (options.toolMode === 'read_only') {
    return capability === 'read' || capability === 'pin_read';
  }
  if (options.toolMode === 'proposal_only') {
    return capability === 'read' || capability === 'proposal';
  }
  return capability !== 'pin_mutation' || Boolean(options.allowPinMutations);
}

export function proposalIdsForTool(definition: ToolSet[string], output: unknown): string[] {
  if ((definition as PolicyTool)[TOOL_POLICY]?.capability !== 'proposal') return [];
  if (!output || typeof output !== 'object' || Array.isArray(output)) return [];
  const row = output as Record<string, unknown>;
  if (row.ok === false) return [];
  const id = typeof row.suggestion_id === 'string' ? row.suggestion_id : row.id;
  return typeof id === 'string' ? [id] : [];
}
