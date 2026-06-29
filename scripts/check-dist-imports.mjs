const checks = [
  {
    name: '@timeline/shared calendar recurrence',
    run: async () => {
      const recurrence = await import('../packages/shared/dist/calendar/recurrence.js');
      const normalized = recurrence.validateRRule({
        rrule: 'FREQ=DAILY;COUNT=1',
        startAt: new Date('2026-07-01T09:00:00.000Z'),
        timezone: 'UTC',
      });

      if (normalized !== 'RRULE:FREQ=DAILY;COUNT=1') {
        throw new Error(`Unexpected RRULE normalization result: ${normalized}`);
      }
    },
  },
  {
    name: '@timeline/shared object client types',
    run: async () => {
      const { entityType } = await import('@timeline/db');
      const objectTypes = await import('@timeline/shared/objects/types');

      const dbTypes = [...entityType.enumValues];
      const clientTypes = [...objectTypes.OBJECT_TYPES];

      if (JSON.stringify(clientTypes) !== JSON.stringify(dbTypes)) {
        throw new Error(
          `Object type export drifted from DB enum: ${JSON.stringify({
            clientTypes,
            dbTypes,
          })}`,
        );
      }

      const title = objectTypes.displayObjectTitle({
        canonicalName: 'github/repo#1: Raw title',
        metadata: {
          display_title: 'repo: Raw title',
          display_title_canonical_name: 'github/repo#1: Raw title',
        },
      });

      if (title !== 'repo: Raw title') {
        throw new Error(`Unexpected display title: ${title}`);
      }
    },
  },
  {
    name: '@timeline/shared reconciliation exports',
    run: async () => {
      const reconciliation = await import('@timeline/shared/reconciliation');
      const authority = await import('@timeline/shared/reconciliation/authority');
      const normalization = await import('@timeline/shared/reconciliation/normalization');
      const resolver = await import('@timeline/shared/reconciliation/resolver');
      const backfill = await import('@timeline/shared/reconciliation/backfill');
      const planner = await import('@timeline/shared/reconciliation/planner');
      const evalManifests = await import('@timeline/shared/reconciliation/eval-manifests');

      if (!reconciliation.artifactClusterKinds.includes('customer_project')) {
        throw new Error('Reconciliation cluster kinds missing customer_project');
      }

      const validation = reconciliation.validateSourceRefs([
        { source: 'email', rawEventId: '11111111-1111-4111-8111-111111111111' },
      ]);
      if (!validation.ok) {
        throw new Error(`Expected source ref validation to pass: ${validation.errors.join(', ')}`);
      }

      if (typeof normalization.normalizeRawEventsToEvidence !== 'function') {
        throw new Error('normalizeRawEventsToEvidence export is missing');
      }

      if (
        authority.evaluateAuthorityPolicy({
          source: 'integration',
          provider: 'sentry',
          eventType: 'issue.resolved',
          targetKind: 'cluster_lifecycle',
          targetField: 'status',
          externalObjectId: 'SENTRY-1',
          visibility: 'team',
          confidence: 'high',
        }).decision !== 'direct'
      ) {
        throw new Error('evaluateAuthorityPolicy did not allow provider-owned lifecycle update');
      }

      if (typeof resolver.resolveEvidenceAssociations !== 'function') {
        throw new Error('resolveEvidenceAssociations export is missing');
      }

      if (typeof backfill.auditReconciliationEvidenceCoverage !== 'function') {
        throw new Error('auditReconciliationEvidenceCoverage export is missing');
      }

      if (typeof planner.planReconciliation !== 'function') {
        throw new Error('planReconciliation export is missing');
      }

      if (!planner.reconciliationPlannerOutputKinds.includes('approval_bundle')) {
        throw new Error('Reconciliation planner output kinds missing approval_bundle');
      }

      if (
        !evalManifests.RECONCILIATION_EVAL_SURFACE_MANIFESTS.some(
          (manifest) => manifest.name === 'email',
        )
      ) {
        throw new Error('Reconciliation eval surface manifests missing email');
      }
    },
  },
];

for (const check of checks) {
  try {
    await check.run();
    console.log(`[dist-imports] ${check.name}: ok`);
  } catch (error) {
    console.error(`[dist-imports] ${check.name}: failed`);
    throw error;
  }
}
