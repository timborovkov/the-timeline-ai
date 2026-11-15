import {
  COMM_ACTORS,
  communicationId,
  type CommunicationCase,
  type CommunicationObservation,
  type ObservedNode,
} from '#src/evals/communication-types.js';
import { summarizeSuggestions } from '#src/evals/suggestion-report.js';

/** Score the approved graph, including preservation of existing records. Counts are graph assertions, not independent examples. */
export function scoreCommunications(row: CommunicationCase, observation: CommunicationObservation) {
  const assigned = new Map<string, ObservedNode>();
  const used = new Set<string>();
  let matched = 0;
  for (const expected of row.outcome.nodes) {
    const seeded = row.seed.some((node) => node.key === expected.key);
    const candidates = observation.nodes.filter(
      (node) =>
        !used.has(node.id) &&
        node.type === expected.type &&
        (seeded
          ? node.id === communicationId(row.familyId, expected.key) && node.name === expected.name
          : expected.terms?.length
            ? expected.terms.every((group) =>
                group.some((term) => node.name.toLowerCase().includes(term.toLowerCase())),
              )
            : node.name.toLowerCase() === expected.name.toLowerCase()),
    );
    const node = candidates[0];
    if (!node) continue;
    assigned.set(expected.key, node);
    used.add(node.id);
    if (
      (expected.status === undefined || node.status === expected.status) &&
      (expected.assignee === undefined ||
        node.assigneeUserId ===
          (expected.assignee === null ? null : COMM_ACTORS[expected.assignee])) &&
      (expected.dueAt === undefined || node.dueAt === expected.dueAt)
    )
      matched++;
  }
  const edgeMatches = (
    edge: CommunicationObservation['edges'][number],
    from: string,
    to: string,
    kind: string,
  ) =>
    edge.kind === kind &&
    ((edge.from === from && edge.to === to) ||
      (kind === 'related' && edge.from === to && edge.to === from));
  const requiredEdges = new Set<number>();
  for (const expected of row.outcome.edges) {
    const from = assigned.get(expected.from),
      to = assigned.get(expected.to);
    if (!from || !to) continue;
    const index = observation.edges.findIndex(
      (edge, index) =>
        !requiredEdges.has(index) && edgeMatches(edge, from.id, to.id, expected.kind),
    );
    if (index >= 0) {
      requiredEdges.add(index);
      matched++;
    }
  }
  // A grounded company/project association is optional only when there is exactly one of each.
  const companies = row.outcome.nodes.filter((node) => node.type === 'company'),
    projects = row.outcome.nodes.filter((node) => node.type === 'project');
  const company =
      companies.length === 1 && companies[0] ? assigned.get(companies[0].key) : undefined,
    project = projects.length === 1 && projects[0] ? assigned.get(projects[0].key) : undefined;
  const allowedEdges = observation.edges.filter(
    (edge, index) =>
      !requiredEdges.has(index) &&
      company &&
      project &&
      edgeMatches(edge, company.id, project.id, 'related'),
  ).length;
  const expected = row.outcome.nodes.length + row.outcome.edges.length;
  const proposed = observation.nodes.length + observation.edges.length;
  const calendarCompanions = new Set<string>();
  let extraActionNoise = 0;
  for (const action of observation.actions) {
    if (['task', 'object', 'object_relationship'].includes(action.targetKind)) continue;
    const deadline =
      action.targetKind === 'calendar_event' &&
      action.operation === 'create' &&
      typeof action.proposedPayload.startAt === 'string'
        ? row.outcome.nodes.find(
            (node) =>
              !calendarCompanions.has(node.key) &&
              node.dueAt &&
              Date.parse(action.proposedPayload.startAt as string) === Date.parse(node.dueAt) &&
              (node.terms ?? [[node.name]]).every((group) =>
                group.some((term) =>
                  `${action.title} ${typeof action.proposedPayload.title === 'string' ? action.proposedPayload.title : ''}`
                    .toLowerCase()
                    .includes(term.toLowerCase()),
                ),
              ),
          )
        : undefined;
    if (deadline) calendarCompanions.add(deadline.key);
    else extraActionNoise++;
  }
  const noise =
    observation.nodes.length -
    used.size +
    observation.edges.length -
    requiredEdges.size -
    allowedEdges +
    observation.duplicateProposals +
    extraActionNoise;
  const hardFailure =
    observation.unauthorizedDisclosure ||
    observation.canonicalMutation ||
    observation.invalidEvidence ||
    observation.protectedPendingChanged;
  const executionFailure =
    observation.executionErrors.length > 0 ||
    observation.acceptanceErrors > 0 ||
    observation.packetLoss.length > 0;
  const missed = expected - matched;
  return {
    expected,
    proposed,
    matched,
    allowed: allowedEdges,
    missed,
    noise,
    hardFailure,
    executionFailure,
    passed:
      !hardFailure &&
      !executionFailure &&
      !observation.uncertaintyMissing &&
      missed === 0 &&
      noise === 0,
  };
}
export type CommunicationResult = CommunicationObservation & {
  id: string;
  tags: string[];
  score: ReturnType<typeof scoreCommunications>;
};
export function summarizeCommunications(rows: CommunicationResult[]) {
  const group = (key: 'source' | 'familyId') =>
    [...new Set(rows.map((row) => row[key]))].sort().map((value) => ({
      [key]: value,
      ...summarizeSuggestions(rows.filter((row) => row[key] === value)),
    }));
  return {
    ...summarizeSuggestions(rows),
    scoringUnit: 'approved-graph-assertions',
    sources: group('source'),
    families: group('familyId'),
    packetLossCases: rows.filter((row) => row.packetLoss.length).map((row) => row.id),
    acceptanceFailures: rows.reduce((sum, row) => sum + row.acceptanceErrors, 0),
  };
}
