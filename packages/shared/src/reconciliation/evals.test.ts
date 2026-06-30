import { describe, expect, it } from 'vitest';

import {
  RECONCILIATION_DETERMINISTIC_EVAL_CASES,
  REQUIRED_RECONCILIATION_EVAL_SCENARIOS,
  REQUIRED_RECONCILIATION_EVAL_SURFACES,
} from '#src/reconciliation/eval-cases.js';
import {
  RECONCILIATION_EVAL_SCENARIO_MANIFESTS,
  RECONCILIATION_EVAL_SURFACE_MANIFESTS,
} from '#src/reconciliation/eval-manifests.js';
import {
  scoreDeterministicReconciliationCase,
  scoreReconciliationEvalSuite,
} from '#src/reconciliation/index.js';

const TEAM_VISIBILITY = { visibility: 'team' as const };
const PRIVATE_OWNER = {
  visibility: 'private' as const,
  visibilityOwnerUserId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
};

describe('deterministic reconciliation evals', () => {
  it('covers every required ingestion surface and scenario family', () => {
    const result = scoreReconciliationEvalSuite(RECONCILIATION_DETERMINISTIC_EVAL_CASES, {
      ingestionSurfaces: REQUIRED_RECONCILIATION_EVAL_SURFACES,
      scenarioFamilies: REQUIRED_RECONCILIATION_EVAL_SCENARIOS,
    });
    expect(result.failures).toEqual([]);
    expect(result.passed).toBe(true);
  });

  it.each(RECONCILIATION_DETERMINISTIC_EVAL_CASES)('scores $name', (testCase) => {
    const result = scoreDeterministicReconciliationCase(testCase);
    expect(result.failures).toEqual([]);
    expect(result.passed).toBe(true);
  });

  it('keeps surface manifests aligned with deterministic fixture cases', () => {
    expect(RECONCILIATION_EVAL_SURFACE_MANIFESTS.map((manifest) => manifest.name).sort()).toEqual(
      [...REQUIRED_RECONCILIATION_EVAL_SURFACES].sort(),
    );

    for (const manifest of RECONCILIATION_EVAL_SURFACE_MANIFESTS) {
      expect(manifest.manifestKind).toBe('surface');
      expect(manifest.caseNames.length).toBeGreaterThan(0);
      expect(manifest.promptVersions).toContain('reconciliation-deterministic-matrix-2026-06');
      expect(manifest.promptVersions).toContain('reconciliation-live-matrix-2026-06');
      expect(manifest.minimumScore).toEqual({ deterministic: 1, live: 1 });

      const surface = manifest.ingestionSurfaces[0];
      expect(surface).toBe(manifest.name);
      const cases = casesNamed(manifest.caseNames);
      expect(manifest.expectedOutputKinds).toEqual(
        uniqueSorted(cases.flatMap((testCase) => Object.keys(testCase.expected.outputKindCounts))),
      );
      expect(manifest.expectedAssociationRoles).toEqual(
        uniqueSorted(
          cases.flatMap((testCase) => Object.keys(testCase.expected.associationRoleCounts ?? {})),
        ),
      );
      expect(manifest.expectedArtifactClusterKinds).toEqual(
        uniqueSorted(
          cases.flatMap((testCase) => testCase.expected.requiredArtifactClusterKinds ?? []),
        ),
      );
      expect(manifest.requiredSourcePayloadSurfaces).toEqual(
        uniqueSorted(
          cases.flatMap((testCase) => testCase.expected.requiredSourcePayloadSurfaces ?? []),
        ),
      );
      expect(manifest.forbiddenOutputKinds).toEqual(
        uniqueSorted(cases.flatMap((testCase) => testCase.expected.forbiddenOutputKinds ?? [])),
      );
      for (const testCase of cases) {
        expect(testCase.ingestionSurfaces).toContain(surface);
      }
    }
  });

  it('keeps scenario manifests aligned with deterministic fixture cases', () => {
    expect(RECONCILIATION_EVAL_SCENARIO_MANIFESTS.map((manifest) => manifest.name).sort()).toEqual(
      [...REQUIRED_RECONCILIATION_EVAL_SCENARIOS].sort(),
    );

    for (const manifest of RECONCILIATION_EVAL_SCENARIO_MANIFESTS) {
      expect(manifest.manifestKind).toBe('scenario');
      expect(manifest.scenarioFamily).toBe(manifest.name);
      expect(manifest.caseNames.length).toBeGreaterThan(0);
      expect(manifest.visibilityAssertions).toContain('visibility_floor');

      const cases = casesNamed(manifest.caseNames);
      expect(manifest.ingestionSurfaces).toEqual(
        [...new Set(cases.flatMap((testCase) => testCase.ingestionSurfaces))].sort(),
      );
      expect(manifest.expectedOutputKinds).toEqual(
        uniqueSorted(cases.flatMap((testCase) => Object.keys(testCase.expected.outputKindCounts))),
      );
      expect(manifest.expectedAssociationRoles).toEqual(
        uniqueSorted(
          cases.flatMap((testCase) => Object.keys(testCase.expected.associationRoleCounts ?? {})),
        ),
      );
      expect(manifest.expectedArtifactClusterKinds).toEqual(
        uniqueSorted(
          cases.flatMap((testCase) => testCase.expected.requiredArtifactClusterKinds ?? []),
        ),
      );
      expect(manifest.requiredSourcePayloadSurfaces).toEqual(
        uniqueSorted(
          cases.flatMap((testCase) => testCase.expected.requiredSourcePayloadSurfaces ?? []),
        ),
      );
      expect(manifest.forbiddenOutputKinds).toEqual(
        uniqueSorted(cases.flatMap((testCase) => testCase.expected.forbiddenOutputKinds ?? [])),
      );
      for (const testCase of cases) {
        expect(testCase.scenarioFamily).toBe(manifest.scenarioFamily);
      }
    }
  });

  it('fails fixtures that promote private evidence into team-visible outputs', () => {
    const result = scoreDeterministicReconciliationCase({
      name: 'private-email-leak',
      ingestionSurfaces: ['email'],
      associations: [
        {
          id: 'leaky-association',
          role: 'discussion',
          visibility: TEAM_VISIBILITY,
          visibilityFloor: PRIVATE_OWNER,
          sourceRefs: [{ source: 'email', rawEventId: 'raw-private' }],
        },
      ],
      outputs: [
        {
          id: 'leaky-approval',
          outputKind: 'approval_bundle',
          targetKind: 'object',
          operation: 'create',
          visibility: TEAM_VISIBILITY,
          visibilityFloor: PRIVATE_OWNER,
          sourceRefs: [{ source: 'email', rawEventId: 'raw-private' }],
        },
      ],
      expected: {
        ingestionSurfaces: ['email'],
        outputKindCounts: { approval_bundle: 1 },
        requireValidSourceRefs: true,
        requireVisibilityFloors: true,
      },
    });

    expect(result.passed).toBe(false);
    expect(result.failures).toEqual([
      'private-email-leak:leaky-approval: output visibility exceeds visibility floor',
      'private-email-leak:leaky-association: association visibility exceeds visibility floor',
    ]);
  });

  it('fails fixtures that omit required artifact cluster kinds', () => {
    const result = scoreDeterministicReconciliationCase({
      name: 'missing-provider-record-kind',
      ingestionSurfaces: ['sentry'],
      outputs: [
        {
          id: 'sentry-release-link',
          outputKind: 'observed_association',
          targetKind: 'cluster_identity',
          operation: 'link',
          artifactClusterKind: 'incident',
          visibility: TEAM_VISIBILITY,
          visibilityFloor: TEAM_VISIBILITY,
          sourceRefs: [{ source: 'sentry', rawEventId: 'raw-release' }],
        },
      ],
      expected: {
        ingestionSurfaces: ['sentry'],
        outputKindCounts: { observed_association: 1 },
        requireValidSourceRefs: true,
        requireVisibilityFloors: true,
        requiredArtifactClusterKinds: ['provider_record'],
      },
    });

    expect(result.passed).toBe(false);
    expect(result.failures).toEqual([
      'missing-provider-record-kind: missing artifact cluster kind provider_record',
    ]);
  });

  it('fails fixtures that emit forbidden output kinds', () => {
    const result = scoreDeterministicReconciliationCase({
      name: 'forbidden-private-direct-write',
      ingestionSurfaces: ['calendar'],
      outputs: [
        {
          id: 'private-calendar-direct-write',
          outputKind: 'direct_write',
          targetKind: 'task',
          operation: 'create',
          visibility: PRIVATE_OWNER,
          visibilityFloor: PRIVATE_OWNER,
          sourceRefs: [{ source: 'calendar', rawEventId: 'raw-private-calendar' }],
        },
      ],
      expected: {
        ingestionSurfaces: ['calendar'],
        outputKindCounts: { direct_write: 1 },
        forbiddenOutputKinds: ['direct_write'],
        requireValidSourceRefs: true,
        requireVisibilityFloors: true,
      },
    });

    expect(result.passed).toBe(false);
    expect(result.failures).toEqual([
      'forbidden-private-direct-write: forbidden output kind direct_write appeared 1 time(s)',
    ]);
  });
});

function casesNamed(caseNames: string[]): typeof RECONCILIATION_DETERMINISTIC_EVAL_CASES {
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
