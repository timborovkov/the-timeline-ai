import {
  artifactRefCitation,
  citationPartToArtifactRef,
  parseCitations,
  type ArtifactRef,
} from '@timeline/shared/citation';
import type { UIMessage } from 'ai';

// These event reads associate the returned evidence with a scoped event.
// Composite queries can embed board and proposal data without a reference.
const SOURCE_TOOLS = new Set(['list_events', 'get_event', 'search_timeline']);

const OPAQUE_CONTEXT_KEYS = new Set([
  'currentBoardItems',
  'currentProposals',
  'pendingProposals',
  'recentProposals',
  'proposals',
  'boardContext',
  'pendingApprovals',
]);

function citationRefs(text: string): ArtifactRef[] {
  return parseCitations(text).flatMap((part) =>
    part.type === 'text' ? [] : [citationPartToArtifactRef(part)],
  );
}

function resultRefs(output: unknown, refs: ArtifactRef[], depth = 0): boolean {
  if (depth > 16 || refs.length > 200) return false;
  if (typeof output === 'string') {
    refs.push(...citationRefs(output));
    return refs.length <= 200;
  }
  if (output === null || typeof output !== 'object') return true;
  if (Array.isArray(output)) return output.every((value) => resultRefs(value, refs, depth + 1));
  return Object.entries(output).every(([key, value]) => {
    if (OPAQUE_CONTEXT_KEYS.has(key)) return Array.isArray(value) && value.length === 0;
    return resultRefs(value, refs, depth + 1);
  });
}

export function handoffProvenance(message: UIMessage, freshTurn: boolean): ArtifactRef[] | null {
  if (!freshTurn) return null;
  const all: ArtifactRef[] = [];
  for (const part of message.parts) {
    if (part.type === 'text' || part.type === 'step-start' || part.type === 'reasoning') continue;
    if (
      !('state' in part) ||
      part.state !== 'output-available' ||
      !('output' in part) ||
      !part.type.startsWith('tool-') ||
      !SOURCE_TOOLS.has(part.type.slice(5))
    ) {
      return null;
    }
    const refs: ArtifactRef[] = [];
    if (!resultRefs(part.output, refs) || refs.length === 0) return null;
    all.push(...refs);
  }
  const refs = new Map(all.map((ref) => [artifactRefCitation(ref), ref]));
  const cited = message.parts.flatMap((part) =>
    part.type === 'text' ? citationRefs(part.text) : [],
  );
  if (
    cited.length === 0 ||
    refs.size > 100 ||
    cited.some((ref) => !refs.has(artifactRefCitation(ref)))
  ) {
    return null;
  }
  return [...refs.values()];
}
