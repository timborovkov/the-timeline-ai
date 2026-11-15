import type { SuggestionCase } from '#src/evals/suggestion-cases.js';

const TASK = '44444444-4444-4444-8444-444444444444';
const SECOND = '55555555-5555-4555-8555-555555555555';
const PROJECT = '33333333-3333-4333-8333-333333333333';
const repo = 'example/northstar';
const externalId = `${repo}#42`;
const linked = {
  id: TASK,
  name: 'Fix keyboard navigation',
  status: 'doing',
  metadata: { integration_provider: 'github', integration_external_id: externalId },
};
const done = {
  operation: 'update' as const,
  targetKind: 'task',
  targetId: TASK,
  terms: [],
  fields: { status: 'done' },
};
const metadata = (merged = true) => ({
  provider: 'github',
  signal_class: 'captured_work',
  event_type: merged ? 'pr.merged' : 'pr.closed',
  external_object_id: externalId,
  github: {
    type: 'pull_request',
    repo,
    number: 42,
    state: 'closed',
    ...(merged ? { merged_at: '2026-06-01T09:00:00.000Z' } : {}),
  },
  object_map: {
    type: 'task',
    canonicalName: 'Fix keyboard navigation',
    externalId,
    status: merged ? 'done' : 'cancelled',
  },
});
const base = {
  split: 'development' as const,
  familyId: 'github-completion',
  source: 'integration' as const,
  tags: ['github', 'github-completion', 'delivery'],
  eventMetadata: metadata(),
};
/** Related cases deliberately remain development-only; the inspected holdout is not refreshed by adding them. */
export const GITHUB_SUGGESTION_CASES: SuggestionCase[] = [
  {
    ...base,
    id: 'github-merged-linked',
    events: ['Merged PR #42: Fix keyboard navigation.'],
    taskFixtures: [linked],
    expected: [done],
    rationale:
      'A merged PR with the same provider identity as an open task supports a visible done proposal, not a direct status write.',
  },
  {
    ...base,
    id: 'github-closed-unmerged',
    events: ['Closed PR #42 without merging: Fix keyboard navigation.'],
    eventMetadata: metadata(false),
    taskFixtures: [linked],
    expected: [],
    rationale: 'Closing an unmerged PR does not establish that the linked task is complete.',
  },
  {
    ...base,
    id: 'github-already-completed',
    events: ['Merged PR #42 reminder: keyboard navigation was completed earlier.'],
    taskFixtures: [{ ...linked, status: 'done' }],
    expected: [],
    rationale: 'A completed linked task must not generate another completion proposal.',
  },
  {
    ...base,
    id: 'github-duplicate-webhook',
    events: [
      'Merged PR #42 webhook: Fix keyboard navigation.',
      'Merged PR #42 webhook: Fix keyboard navigation.',
    ],
    taskFixtures: [linked],
    githubJobExternalId: externalId,
    replay: true,
    expected: [done],
    rationale:
      'The coalesced GitHub job sees the latest event; repeated job delivery must leave exactly one visible update.',
  },
  {
    ...base,
    id: 'github-ambiguous-tasks',
    events: ['Merged PR #42: keyboard navigation fix, possible duplicate local tasks.'],
    taskFixtures: [
      { id: TASK, name: 'Fix keyboard navigation northstar PR #42', status: 'todo' },
      { id: SECOND, name: 'Fix keyboard navigation northstar #42 follow-up', status: 'doing' },
    ],
    expected: [],
    rationale:
      'Two equally plausible title matches do not identify which task should be completed.',
  },
  {
    ...base,
    id: 'github-partial-work',
    events: [
      'Merged PR #42: keyboard navigation only. Part of issue #77 accessibility overhaul; screen reader work remains.',
    ],
    projectAliases: [repo],
    taskFixtures: [
      {
        id: TASK,
        name: 'Northstar accessibility overhaul, including keyboard and screen reader support',
        status: 'doing',
        metadata: { integration_provider: 'github', integration_external_id: `${repo}#issue:77` },
      },
    ],
    expected: [
      {
        operation: 'create',
        targetKind: 'task',
        terms: [['keyboard'], ['navigation']],
        fields: { status: 'done', parentObjectId: PROJECT },
      },
    ],
    rationale:
      'The merged PR establishes only its own completed work. The separately identified broader issue must remain open; a completed PR task may be proposed under the repository project.',
  },
  {
    ...base,
    id: 'github-completed-new-task',
    events: ['Merged PR #42: delivered keyboard navigation, no existing local task.'],
    projectAliases: [repo],
    githubJobExternalId: externalId,
    expected: [
      {
        operation: 'create',
        targetKind: 'task',
        terms: [['keyboard'], ['navigation']],
        fields: { status: 'done', parentObjectId: PROJECT },
      },
    ],
    rationale:
      'When no local task exists, a merged PR in a uniquely resolved repository project supports creating a completed-task suggestion.',
  },
  {
    ...base,
    id: 'github-other-repository',
    events: ['Merged northstar PR #42: keyboard navigation, not the mobile repository PR.'],
    taskFixtures: [
      {
        ...linked,
        metadata: { integration_provider: 'github', integration_external_id: 'example/mobile#42' },
        aliases: ['example/mobile#42', 'PR #42'],
      },
    ],
    projectAliases: [repo],
    expected: [
      {
        operation: 'create',
        targetKind: 'task',
        terms: [['keyboard'], ['navigation']],
        fields: { status: 'done', parentObjectId: PROJECT },
      },
    ],
    rationale:
      'Repository-local PR numbers cannot complete the mobile task. The merged Northstar PR may instead produce its own completed task under the uniquely resolved project.',
  },
  {
    ...base,
    id: 'github-private-event',
    events: ['Private merged PR #42: Fix keyboard navigation.'],
    eventVisibility: 'private',
    taskFixtures: [linked],
    expected: [],
    rationale: 'Private captured evidence must not originate a team-wide completion suggestion.',
  },
];
