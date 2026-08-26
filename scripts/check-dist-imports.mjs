const checks = [
  {
    name: '@timeline/shared OpenRouter privacy attestation',
    run: async () => {
      const attestation = await import('@timeline/shared/llm/privacy-attestation');
      const syntheticKey = 'sk-or-dist-import-synthetic-only';
      const guardrailId = 'dist-import-guardrail';
      const token = attestation.buildOpenRouterPrivacyAttestationToken({
        apiKey: syntheticKey,
        guardrailId,
      });
      const payload = attestation.parseOpenRouterPrivacyAttestationToken(token);

      if (!/^[0-9a-f]{64}$/.test(attestation.OPENROUTER_MODEL_CATALOG_SHA256)) {
        throw new Error('OpenRouter model-catalog digest export is missing or invalid');
      }
      if (
        payload?.catalogSha256 !== attestation.OPENROUTER_MODEL_CATALOG_SHA256 ||
        payload.guardrailId !== guardrailId ||
        !attestation.isCurrentOpenRouterPrivacyAttestation(token, {
          apiKey: syntheticKey,
          guardrailId,
        })
      ) {
        throw new Error('OpenRouter privacy-attestation compiled export is invalid');
      }
      if (token.includes(syntheticKey)) {
        throw new Error('OpenRouter privacy attestation leaked the inference key');
      }
    },
  },
  {
    name: '@timeline/shared legal versions',
    run: async () => {
      const legalVersions = await import('@timeline/shared/legal-versions');
      const versionPattern = /^\d{4}-\d{2}-\d{2}$/;
      if (
        !versionPattern.test(legalVersions.TERMS_VERSION) ||
        !versionPattern.test(legalVersions.PRIVACY_VERSION)
      ) {
        throw new Error('Legal-version exports are missing or are not date-versioned');
      }
    },
  },
  {
    name: '@timeline/shared evidence pack',
    run: async () => {
      const evidencePack = await import('@timeline/shared/evidence-pack');
      if (evidencePack.EVIDENCE_PACK_VERSION !== 'evidence-pack-v1') {
        throw new Error('Evidence-pack version export is missing or incorrect');
      }
      if (evidencePack.EVIDENCE_PACK_POLICIES.proposal.maxSupportingEvents !== 8) {
        throw new Error('Evidence-pack proposal policy export is missing or incorrect');
      }
    },
  },
  {
    name: '@timeline/shared conversation surfaces',
    run: async () => {
      const conversations = await import('@timeline/shared/conversation-surfaces');
      if (conversations.DIRECT_CONVERSATION_TIMEOUT_MS !== 180_000) {
        throw new Error('Direct-conversation timeout export is missing or incorrect');
      }
      const timeoutSeconds = String(conversations.DIRECT_CONVERSATION_TIMEOUT_MS / 1_000);
      if (
        conversations.CONVERSATION_AGENT_TIMEOUT_MESSAGE !==
        `I couldn’t finish that within ${timeoutSeconds} seconds. Please try again, or start a new conversation.`
      ) {
        throw new Error('Direct-conversation timeout message export is missing or incorrect');
      }
      if (conversations.directConversationTitle('  Weekly   update  ') !== 'Weekly update') {
        throw new Error('Direct-conversation title export did not normalize whitespace');
      }
    },
  },
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

      // `link` is an artifact-only enum value; client object selectors export
      // only user-facing workspace object types.
      const dbTypes = [...entityType.enumValues].filter((type) => type !== 'link');
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
    name: '@timeline/shared object mention helpers',
    run: async () => {
      const mentions = await import('@timeline/shared/objects/mentions');
      const token = mentions.mentionInsertToken(
        { userId: '1', name: 'Casey Novak', email: 'casey@acme.test' },
        [{ userId: '1', name: 'Casey Novak', email: 'casey@acme.test' }],
      );
      if (token !== 'Casey') {
        throw new Error(`Unexpected mention insert token: ${token}`);
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

      if (
        reconciliation.sourcePayloadRefFromMetadata({
          sourcePayloadRef: '  s3://timeline-test/raw-message.eml  ',
        }) !== 's3://timeline-test/raw-message.eml'
      ) {
        throw new Error('sourcePayloadRefFromMetadata export did not trim camelCase metadata');
      }

      if (
        reconciliation.payloadDigestFromMetadata({
          source_payload_digest: '  sha256:timeline-test-raw-message  ',
        }) !== 'sha256:timeline-test-raw-message'
      ) {
        throw new Error('payloadDigestFromMetadata export did not trim digest metadata');
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
  {
    name: '@timeline/shared event class',
    run: async () => {
      const eventClass = await import('@timeline/shared/event-class');
      const classified = eventClass.classifyCapturedEvent({
        source: 'integration',
        metadata: {
          provider: 'gitlab',
          gitlab: { type: 'pipeline' },
        },
      });
      if (classified !== 'pulse') {
        throw new Error(`Unexpected GitLab pipeline class: ${classified}`);
      }
      if (eventClass.visualWeightForEventClass('communication', 'events') !== 'pulse') {
        throw new Error('All events mode should force pulse weight');
      }
      if (eventClass.promotesWorkspaceObject('pulse')) {
        throw new Error('Pulses must not promote workspace objects');
      }
    },
  },
  {
    name: '@timeline/shared timeline moments',
    run: async () => {
      const timelineMoments = await import('@timeline/shared/timeline-moments');
      const moments = timelineMoments.buildTimelineMoments(
        [
          {
            id: 'event-a',
            teamId: 'team-a',
            authorUserId: null,
            contentText: 'GitHub workflow "CI" #1 success',
            contentAudioUrl: null,
            occurredAt: '2026-07-01T09:00:00.000Z',
            createdAt: '2026-07-01T09:00:01.000Z',
            visibility: 'team',
            visibilityUserIds: null,
            visibilityOwnerUserId: null,
            source: 'integration',
            sourceMetadata: {
              provider: 'github',
              event_type: 'workflow_run.success',
              github: {
                type: 'workflow_run',
                repo: 'timborovkov/audit-ai',
                head_branch: 'main',
              },
            },
          },
        ],
        new Map(),
        { now: new Date('2026-07-01T10:00:00.000Z'), timezone: 'UTC' },
      );

      if (moments[0]?.title !== 'CI passed on timborovkov/audit-ai · main') {
        throw new Error(`Unexpected timeline moment title: ${moments[0]?.title ?? 'missing'}`);
      }
      if (moments[0]?.eventClass !== 'pulse' || moments[0]?.visualWeight !== 'pulse') {
        throw new Error(
          `Unexpected timeline moment family: ${moments[0]?.eventClass ?? 'missing'}/${moments[0]?.visualWeight ?? 'missing'}`,
        );
      }
      if (moments[0]?.version !== 'timeline_moment.v1') {
        throw new Error(`Unexpected timeline moment version: ${moments[0]?.version ?? 'missing'}`);
      }
      if (!moments[0]?.anchorId?.startsWith('tm-moment_3Aintegration_3Agithub')) {
        throw new Error(`Unexpected timeline moment anchor: ${moments[0]?.anchorId ?? 'missing'}`);
      }

      const presentation = await import('@timeline/shared/timeline-moments/presentation');
      const key = presentation.buildTimelineMomentPresentationCacheKey({
        teamId: 'team-a',
        moment: moments[0],
      });
      if (!/^[0-9a-f]{64}$/.test(key.visibleSourceContentHash)) {
        throw new Error(
          `Unexpected timeline moment presentation hash: ${key.visibleSourceContentHash}`,
        );
      }
    },
  },
  {
    name: '@timeline/shared messaging format',
    run: async () => {
      const format = await import('@timeline/shared/messaging/format');
      const labeled = format.formatDigestDate('2026-08-17T12:00:00.000Z', 'UTC');
      if (!labeled.includes('Aug') || !labeled.includes('17')) {
        throw new Error(`Unexpected digest date label: ${labeled}`);
      }
      if ('generateDailyDigest' in format) {
        throw new Error('messaging/format must not export digest generation');
      }
      const { readFileSync } = await import('node:fs');
      const source = readFileSync(
        new URL('../packages/shared/dist/messaging/format.js', import.meta.url),
        'utf8',
      );
      if (
        source.includes('digest.js') ||
        source.includes('templates.js') ||
        source.includes('node:fs')
      ) {
        throw new Error('messaging/format compiled output pulled Node digest generation');
      }
    },
  },
  {
    name: '@timeline/shared telegram commands',
    run: async () => {
      const commands = await import('@timeline/shared/telegram/commands');
      const names = commands.TELEGRAM_DM_COMMANDS.map((command) => command.command);
      if (!names.includes('help') || !names.includes('note')) {
        throw new Error(`Telegram DM command catalog missing help/note: ${names.join(', ')}`);
      }
      if (commands.TELEGRAM_BOT_COMMAND_REGISTRATIONS.length !== 3) {
        throw new Error(
          `Expected 3 Telegram command scopes, got ${commands.TELEGRAM_BOT_COMMAND_REGISTRATIONS.length}`,
        );
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
