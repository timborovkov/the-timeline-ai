import type {
  DeterministicEvalCase,
  ReconciliationEvalIngestionSurface,
  ReconciliationEvalScenarioFamily,
} from '#src/reconciliation/index.js';

import {
  RECONCILIATION_DETERMINISTIC_EVAL_CASES,
  REQUIRED_RECONCILIATION_EVAL_SCENARIOS,
  REQUIRED_RECONCILIATION_EVAL_SURFACES,
} from '#src/reconciliation/eval-cases.js';

export type ReconciliationEvalManifestKind = 'surface' | 'scenario';

export interface ReconciliationEvalManifest {
  manifestKind: ReconciliationEvalManifestKind;
  name: string;
  ingestionSurfaces: ReconciliationEvalIngestionSurface[];
  scenarioFamily?: ReconciliationEvalScenarioFamily;
  caseNames: string[];
  expectedOutputKinds: string[];
  expectedAssociationRoles: string[];
  expectedArtifactClusterKinds: string[];
  requiredSourcePayloadSurfaces: ReconciliationEvalIngestionSurface[];
  forbiddenOutputKinds: string[];
  visibilityAssertions: string[];
  promptVersions: string[];
  minimumScore: {
    deterministic: 1;
    live: 1;
  };
}

const LIVE_PROMPT_VERSION = 'reconciliation-live-matrix-2026-06';
const DETERMINISTIC_PROMPT_VERSION = 'reconciliation-deterministic-matrix-2026-06';

const SURFACE_CASE_NAMES = {
  web: ['generic-webhook-web-linear-drive'],
  email: [
    'customer-project-email-monday-sentry',
    'sales-success-renewal-risk-email-slack-meeting-drive',
    'incident-response-sentry-github-slack-email',
  ],
  slack: [
    'sales-success-renewal-risk-email-slack-meeting-drive',
    'incident-response-sentry-github-slack-email',
  ],
  telegram: ['decision-memory-meeting-telegram-document'],
  meeting: [
    'sales-success-renewal-risk-email-slack-meeting-drive',
    'decision-memory-meeting-telegram-document',
  ],
  document: ['decision-memory-meeting-telegram-document'],
  calendar: ['calendar-project-private-visibility'],
  system: ['generic-webhook-web-linear-drive'],
  ingest_webhook: ['generic-webhook-web-linear-drive'],
  github: ['incident-response-sentry-github-slack-email'],
  linear: ['generic-webhook-web-linear-drive'],
  google_drive: [
    'sales-success-renewal-risk-email-slack-meeting-drive',
    'generic-webhook-web-linear-drive',
  ],
  monday: ['customer-project-email-monday-sentry'],
  sentry: ['customer-project-email-monday-sentry', 'incident-response-sentry-github-slack-email'],
  mcp: ['mcp-research-decision-context'],
} satisfies Record<ReconciliationEvalIngestionSurface, string[]>;

const SCENARIO_CASE_NAMES = {
  customer_project: ['customer-project-email-monday-sentry'],
  incident_response: ['incident-response-sentry-github-slack-email'],
  sales_success: ['sales-success-renewal-risk-email-slack-meeting-drive'],
  decision_memory: ['decision-memory-meeting-telegram-document', 'mcp-research-decision-context'],
  calendar_project: ['calendar-project-private-visibility'],
  generic_webhook: ['generic-webhook-web-linear-drive'],
} satisfies Record<ReconciliationEvalScenarioFamily, string[]>;

export const RECONCILIATION_EVAL_SURFACE_MANIFESTS: ReconciliationEvalManifest[] =
  REQUIRED_RECONCILIATION_EVAL_SURFACES.map((surface) =>
    buildManifest({
      manifestKind: 'surface',
      name: surface,
      ingestionSurfaces: [surface],
      cases: casesByName(SURFACE_CASE_NAMES[surface]),
    }),
  );

export const RECONCILIATION_EVAL_SCENARIO_MANIFESTS: ReconciliationEvalManifest[] =
  REQUIRED_RECONCILIATION_EVAL_SCENARIOS.map((scenarioFamily) => {
    const cases = casesByName(SCENARIO_CASE_NAMES[scenarioFamily]);

    return buildManifest({
      manifestKind: 'scenario',
      name: scenarioFamily,
      scenarioFamily,
      ingestionSurfaces: uniqueSorted(
        cases.flatMap((testCase) => testCase.ingestionSurfaces),
      ) as ReconciliationEvalIngestionSurface[],
      cases,
    });
  });

function buildManifest(input: {
  manifestKind: ReconciliationEvalManifestKind;
  name: string;
  ingestionSurfaces: ReconciliationEvalIngestionSurface[];
  scenarioFamily?: ReconciliationEvalScenarioFamily;
  cases: DeterministicEvalCase[];
}): ReconciliationEvalManifest {
  const base = {
    manifestKind: input.manifestKind,
    name: input.name,
    ingestionSurfaces: input.ingestionSurfaces,
    caseNames: input.cases.map((testCase) => testCase.name).sort(),
    expectedOutputKinds: uniqueSorted(
      input.cases.flatMap((testCase) => Object.keys(testCase.expected.outputKindCounts)),
    ),
    expectedAssociationRoles: uniqueSorted(
      input.cases.flatMap((testCase) => Object.keys(testCase.expected.associationRoleCounts ?? {})),
    ),
    expectedArtifactClusterKinds: uniqueSorted(
      input.cases.flatMap((testCase) => testCase.expected.requiredArtifactClusterKinds ?? []),
    ),
    requiredSourcePayloadSurfaces: uniqueSorted(
      input.cases.flatMap((testCase) => testCase.expected.requiredSourcePayloadSurfaces ?? []),
    ) as ReconciliationEvalIngestionSurface[],
    forbiddenOutputKinds: uniqueSorted(
      input.cases.flatMap((testCase) => testCase.expected.forbiddenOutputKinds ?? []),
    ),
    visibilityAssertions: uniqueSorted(
      input.cases.flatMap((testCase) =>
        testCase.expected.requireVisibilityFloors ? ['visibility_floor'] : [],
      ),
    ),
    promptVersions: [DETERMINISTIC_PROMPT_VERSION, LIVE_PROMPT_VERSION],
    minimumScore: {
      deterministic: 1,
      live: 1,
    },
  } satisfies Omit<ReconciliationEvalManifest, 'scenarioFamily'>;

  if (!input.scenarioFamily) return base;

  return {
    ...base,
    scenarioFamily: input.scenarioFamily,
  };
}

function casesByName(caseNames: string[]): DeterministicEvalCase[] {
  return caseNames.map((caseName) => {
    const testCase = RECONCILIATION_DETERMINISTIC_EVAL_CASES.find(
      (candidate) => candidate.name === caseName,
    );
    if (!testCase) throw new Error(`Unknown reconciliation eval case: ${caseName}`);
    return testCase;
  });
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort();
}
