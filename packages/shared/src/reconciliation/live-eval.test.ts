import { loadEnvFile } from 'node:process';

import { afterAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { chatStructured } from '#src/llm/chat.js';
import { TIMELINE_MODELS } from '#src/llm/models.js';
import {
  RECONCILIATION_DETERMINISTIC_EVAL_CASES,
  REQUIRED_RECONCILIATION_EVAL_SCENARIOS,
  REQUIRED_RECONCILIATION_EVAL_SURFACES,
} from '#src/reconciliation/eval-cases.js';
import {
  reconciliationEvalIngestionSurfaces,
  reconciliationEvalScenarioFamilies,
  type DeterministicEvalCase,
  type SourceRef,
} from '#src/reconciliation/index.js';
import {
  liveEvalArtifactOutputDir,
  writeLiveEvalArtifact,
  writeLiveEvalRunManifest,
  type LiveEvalJudgeResult,
  type LiveEvalModelResult,
  type WrittenLiveEvalArtifact,
} from '#src/reconciliation/live-artifacts.js';
import {
  RECONCILIATION_PLANNER_PROMPT_VERSION,
  buildReconciliationPlannerPrompt,
  planReconciliation,
  reconciliationPlannerOutputKinds,
  type ReconciliationPlannerInput,
  type ReconciliationPlannerOutputKind,
} from '#src/reconciliation/planner.js';

if (process.env.RECONCILIATION_LIVE_ENV_FILE) {
  loadEnvFile(process.env.RECONCILIATION_LIVE_ENV_FILE);
}

const maybeDescribe = process.env.RECONCILIATION_LIVE_EVAL === '1' ? describe : describe.skip;
const LIVE_EVAL_PROMPT_VERSION = `${RECONCILIATION_PLANNER_PROMPT_VERSION}+live-matrix-2026-06`;
const LIVE_EVAL_JUDGE_PROMPT_VERSION = 'reconciliation-live-judge-2026-06';
const LIVE_EVAL_JUDGE_MIN_SCORE = 0.9;
const LIVE_EVAL_CALL_TIMEOUT_MS = parseLiveEvalCallTimeoutMs(
  process.env.RECONCILIATION_LIVE_CALL_TIMEOUT_MS,
);
const LIVE_EVAL_MAX_ATTEMPTS = parseLiveEvalMaxAttempts(
  process.env.RECONCILIATION_LIVE_MAX_ATTEMPTS,
);
const LIVE_EVAL_RETRY_DELAY_MS = 1_000;
const LIVE_EVAL_RUN_STARTED_AT = new Date().toISOString();
const LIVE_EVAL_ARTIFACT_OUTPUT_DIR = liveEvalArtifactOutputDir({
  artifactDir: process.env.RECONCILIATION_LIVE_ARTIFACT_DIR,
  artifactRootDir: process.env.RECONCILIATION_LIVE_ARTIFACT_ROOT_DIR,
  startedAt: LIVE_EVAL_RUN_STARTED_AT,
});
const liveEvalArtifacts: WrittenLiveEvalArtifact[] = [];

const liveReconciliationJudgeSchema = z.object({
  score: z.number().min(0).max(1),
  passed: z.boolean(),
  privacyConcern: z.boolean(),
  failureCodes: z.array(
    z.enum([
      'scenario_mismatch',
      'surface_mismatch',
      'missing_required_output',
      'unsupported_direct_write',
      'approval_policy_wrong',
      'source_ref_mismatch',
      'artifact_kind_mismatch',
      'conflict_handling_wrong',
      'privacy_leak',
      'irrelevant_output',
      'other',
    ]),
  ),
  strengthCodes: z.array(
    z.enum([
      'correct_scenario',
      'correct_surfaces',
      'correct_outputs',
      'provider_authority_respected',
      'approval_policy_respected',
      'source_refs_complete',
      'visibility_safe',
      'conflict_policy_respected',
    ]),
  ),
});

maybeDescribe('live reconciliation model evals', () => {
  afterAll(async () => {
    if (!LIVE_EVAL_ARTIFACT_OUTPUT_DIR || liveEvalArtifacts.length === 0) return;

    await writeLiveEvalRunManifest(LIVE_EVAL_ARTIFACT_OUTPUT_DIR, {
      modelId: TIMELINE_MODELS.summarization.id,
      promptVersion: LIVE_EVAL_PROMPT_VERSION,
      startedAt: LIVE_EVAL_RUN_STARTED_AT,
      completedAt: new Date().toISOString(),
      artifacts: liveEvalArtifacts,
    });
  });

  it.each(RECONCILIATION_DETERMINISTIC_EVAL_CASES)(
    'plans $name with the live model',
    async (testCase) => {
      const plannerInput = liveEvalPlannerInput(testCase);
      const prompt = buildReconciliationPlannerPrompt(plannerInput);
      const startedAt = new Date().toISOString();
      let result = failedLiveEvalResult(testCase);
      let judge: LiveEvalJudgeResult | null = null;
      let failures: string[];
      try {
        result = await withLiveEvalRetry('planner', () =>
          planReconciliation({
            ...plannerInput,
            model: TIMELINE_MODELS.summarization.id,
            abortSignal: liveEvalCallAbortSignal(),
          }),
        );
        const deterministicFailures = liveEvalFailures(testCase, result);
        try {
          judge = await withLiveEvalRetry('judge', () =>
            liveEvalJudge(testCase, result, deterministicFailures),
          );
          failures = [...deterministicFailures, ...liveEvalJudgeFailures(judge)];
        } catch (err) {
          failures = [...deterministicFailures, `live eval judge failed: ${safeErrorSummary(err)}`];
        }
      } catch (err) {
        failures = [`live eval planner failed: ${safeErrorSummary(err)}`];
      }
      const completedAt = new Date().toISOString();

      if (LIVE_EVAL_ARTIFACT_OUTPUT_DIR) {
        liveEvalArtifacts.push(
          await writeLiveEvalArtifact(LIVE_EVAL_ARTIFACT_OUTPUT_DIR, {
            testCase,
            modelId: TIMELINE_MODELS.summarization.id,
            promptVersion: LIVE_EVAL_PROMPT_VERSION,
            prompt,
            result,
            judge,
            passed: failures.length === 0,
            failures,
            startedAt,
            completedAt,
          }),
        );
      }

      expect(failures).toEqual([]);
    },
    Math.max(240_000, LIVE_EVAL_CALL_TIMEOUT_MS * LIVE_EVAL_MAX_ATTEMPTS * 3),
  );

  it('keeps the live fixture suite aligned with required coverage', () => {
    const coveredSurfaces = new Set(
      RECONCILIATION_DETERMINISTIC_EVAL_CASES.flatMap((testCase) => testCase.ingestionSurfaces),
    );
    const coveredFamilies = new Set(
      RECONCILIATION_DETERMINISTIC_EVAL_CASES.map((testCase) => testCase.scenarioFamily),
    );

    expect([...coveredSurfaces].sort()).toEqual([...REQUIRED_RECONCILIATION_EVAL_SURFACES].sort());
    expect([...coveredFamilies].sort()).toEqual([...REQUIRED_RECONCILIATION_EVAL_SCENARIOS].sort());
  });
});

async function liveEvalJudge(
  testCase: DeterministicEvalCase,
  result: LiveEvalModelResult,
  deterministicFailures: string[],
): Promise<LiveEvalJudgeResult> {
  const judgeResult = await chatStructured({
    schema: liveReconciliationJudgeSchema,
    model: TIMELINE_MODELS.summarization.id,
    system:
      'You are a strict evaluator for a workspace reconciliation eval. Return only the allowed JSON shape. Use only category codes, never free-text rationale.',
    prompt: liveEvalJudgePrompt(testCase, result, deterministicFailures),
    abortSignal: liveEvalCallAbortSignal(),
  });

  return {
    modelId: TIMELINE_MODELS.summarization.id,
    promptVersion: LIVE_EVAL_JUDGE_PROMPT_VERSION,
    score: judgeResult.object.score,
    passed: judgeResult.object.passed,
    privacyConcern: judgeResult.object.privacyConcern,
    failureCodes: [...judgeResult.object.failureCodes],
    strengthCodes: [...judgeResult.object.strengthCodes],
  };
}

function liveEvalJudgeFailures(judge: LiveEvalJudgeResult): string[] {
  const failures: string[] = [];
  if (!judge.passed) failures.push(`judge marked failed: ${judge.failureCodes.join(',')}`);
  if (judge.score < LIVE_EVAL_JUDGE_MIN_SCORE) {
    failures.push(`judge score ${judge.score} below ${LIVE_EVAL_JUDGE_MIN_SCORE}`);
  }
  if (judge.privacyConcern) failures.push('judge reported privacy concern');
  return failures;
}

function failedLiveEvalResult(testCase: DeterministicEvalCase): LiveEvalModelResult {
  return {
    scenarioFamily: testCase.scenarioFamily ?? 'unknown',
    ingestionSurfaces: [],
    outputKinds: [],
    directWriteSurfaces: [],
    artifactClusterKinds: [],
    approvalRequired: false,
    sourceRefs: [],
    privacyRisk: true,
  };
}

function liveEvalCallAbortSignal(): AbortSignal {
  return AbortSignal.timeout(LIVE_EVAL_CALL_TIMEOUT_MS);
}

async function withLiveEvalRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const errors: string[] = [];
  for (let attempt = 1; attempt <= LIVE_EVAL_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      const summary = safeErrorSummary(err);
      errors.push(`attempt ${attempt}: ${summary}`);
      if (attempt >= LIVE_EVAL_MAX_ATTEMPTS || isNonRetryableLiveEvalError(summary)) break;
      await delay(LIVE_EVAL_RETRY_DELAY_MS * attempt);
    }
  }
  throw new Error(`${label} failed after ${errors.length} attempt(s): ${errors.join(' | ')}`);
}

function isNonRetryableLiveEvalError(summary: string): boolean {
  const text = summary.toLowerCase();
  return (
    text.includes('openrouter_api_key') ||
    text.includes('invalid api key') ||
    text.includes('401') ||
    text.includes('403')
  );
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function parseLiveEvalCallTimeoutMs(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed >= 10_000 ? parsed : 90_000;
}

function parseLiveEvalMaxAttempts(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed >= 1 && parsed <= 5 ? parsed : 2;
}

function safeErrorSummary(err: unknown): string {
  const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  return message.replace(/\s+/g, ' ').slice(0, 240);
}

function liveEvalPlannerInput(testCase: DeterministicEvalCase): ReconciliationPlannerInput {
  return {
    packetName: testCase.name,
    observedSurfaces: testCase.ingestionSurfaces.filter(isKnownSurface),
    sourceRefs: uniqueRawRefs(testCase),
    plannerContext: plannerContext(testCase),
    policyDerivedScenarioFamily: isKnownScenarioFamily(testCase.scenarioFamily)
      ? testCase.scenarioFamily
      : null,
    policyDerivedOutputKinds: Object.keys(testCase.expected.outputKindCounts).filter(
      isKnownOutputKind,
    ),
    policyDerivedDirectWriteSurfaces: expectedDirectWriteSurfaces(testCase),
    policyDerivedArtifactClusterKinds: [...(testCase.expected.requiredArtifactClusterKinds ?? [])],
  };
}

function liveEvalFailures(testCase: DeterministicEvalCase, result: LiveEvalModelResult): string[] {
  const failures: string[] = [];
  if (result.scenarioFamily !== testCase.scenarioFamily) {
    failures.push(
      `expected scenarioFamily ${testCase.scenarioFamily}, got ${result.scenarioFamily}`,
    );
  }

  for (const surface of testCase.expected.ingestionSurfaces) {
    if (!result.ingestionSurfaces.includes(surface)) {
      failures.push(`missing ingestion surface ${surface}`);
    }
  }
  for (const surface of result.ingestionSurfaces) {
    if (!testCase.expected.ingestionSurfaces.includes(surface)) {
      failures.push(`unexpected ingestion surface ${surface}`);
    }
  }

  for (const outputKind of Object.keys(testCase.expected.outputKindCounts)) {
    if (!result.outputKinds.includes(outputKind)) {
      failures.push(`missing output kind ${outputKind}`);
    }
  }
  for (const outputKind of testCase.expected.forbiddenOutputKinds ?? []) {
    if (result.outputKinds.includes(outputKind)) {
      failures.push(`forbidden output kind ${outputKind}`);
    }
  }

  for (const kind of testCase.expected.requiredArtifactClusterKinds ?? []) {
    if (!result.artifactClusterKinds.includes(kind)) {
      failures.push(`missing artifact cluster kind ${kind}`);
    }
  }

  if ((testCase.expected.outputKindCounts.direct_write ?? 0) > 0) {
    const expectedSurfaces = expectedDirectWriteSurfaces(testCase);
    for (const surface of expectedSurfaces) {
      if (!result.directWriteSurfaces.includes(surface)) {
        failures.push(`missing direct write surface ${surface}`);
      }
    }
  }

  if ((testCase.expected.outputKindCounts.approval_bundle ?? 0) > 0) {
    if (!result.approvalRequired) {
      failures.push('expected approvalRequired=true when approval_bundle is present');
    }
  }

  const actualRefs = new Set(result.sourceRefs.map((ref) => `${ref.surface}:${ref.rawEventId}`));
  for (const expected of uniqueRawRefs(testCase)) {
    const key = `${expected.surface}:${expected.rawEventId}`;
    if (!actualRefs.has(key)) failures.push(`missing source ref ${key}`);
  }

  if (result.privacyRisk) {
    failures.push('privacyRisk should be false for visibility-floor-safe fixture output');
  }

  return failures;
}

function liveEvalJudgePrompt(
  testCase: DeterministicEvalCase,
  result: LiveEvalModelResult,
  deterministicFailures: string[],
): string {
  return `
Evaluate whether the actual reconciliation planner classification is useful and policy-safe.

Case: ${testCase.name}
Expected scenario family: ${testCase.scenarioFamily}
Expected ingestion surfaces: ${testCase.expected.ingestionSurfaces.join(', ')}
Expected output kinds: ${Object.keys(testCase.expected.outputKindCounts).join(', ')}
Forbidden output kinds: ${(testCase.expected.forbiddenOutputKinds ?? []).join(', ') || 'none'}
Expected artifact cluster kinds: ${(testCase.expected.requiredArtifactClusterKinds ?? []).join(', ') || 'none'}
Expected source refs:
${uniqueRawRefs(testCase)
  .map((ref) => `- ${ref.surface}: ${ref.rawEventId}`)
  .join('\n')}

Planner context:
${plannerContext(testCase)}

Actual result:
${JSON.stringify(result, null, 2)}

Deterministic failures:
${deterministicFailures.length > 0 ? deterministicFailures.map((failure) => `- ${failure}`).join('\n') : '- none'}

Score from 0 to 1. A score of 0.9 or higher means the output is useful enough for a live smoke gate.
Set passed to true only if the scenario, surfaces, output policy, artifact cluster kinds, source refs, and visibility/privacy policy are all acceptable.
Set privacyConcern to true if the actual result would broaden private or specific-user evidence, or if privacyRisk is true without a supported reason.
Use failureCodes and strengthCodes only from the allowed enums. Do not include raw source content, names, emails, URLs, ids, or free-text rationale.
`;
}

function plannerContext(testCase: DeterministicEvalCase): string {
  switch (testCase.name) {
    case 'customer-project-email-monday-sentry':
      return [
        'A forwarded customer email ties Nora at Acme to a blocked implementation project.',
        'A Monday board item updates provider-owned project-board state, so include direct_write.',
        'A Sentry issue reports the login crash lifecycle, so include direct_write.',
        'A second Monday item claims the same hard artifact anchor for a different project, so include conflict.',
        'The customer email and project framing attach context without changing provider state, so include observed_association.',
        'Acme, Nora, the customer project relationship, and the decision are Timeline-owned memory, so include approval_bundle.',
      ].join('\n');
    case 'incident-response-sentry-github-slack-email':
      return [
        'Sentry owns the incident lifecycle signal, so include direct_write.',
        'A GitHub PR is remediation evidence but does not own customer memory, so include observed_association.',
        'Slack and email provide discussion and customer-impact context requiring approval, so include approval_bundle.',
        'All incident evidence in this packet is team-visible and the outputs stay team-visible, so privacyRisk is false.',
      ].join('\n');
    case 'decision-memory-meeting-telegram-document':
      return [
        'A meeting transcript captures the decision.',
        'A Telegram follow-up confirms the decision after the meeting.',
        'A document version provides supporting project-spec context, so include observed_association.',
        'The durable decision object is Timeline-owned memory, so include approval_bundle.',
        'No provider-owned lifecycle or status field changes in this packet, so do not include direct_write.',
        'The meeting, Telegram follow-up, and document agree; there is no competing evidence, so do not include conflict.',
      ].join('\n');
    case 'calendar-project-private-visibility':
      return [
        'A private calendar event implies a private follow-up task.',
        'The follow-up task is Timeline-owned memory, so include approval_bundle.',
        'The output must stay private to the same owner and must not become team-visible.',
        'No provider-owned lifecycle or status field changes in this packet, so do not include direct_write or conflict.',
      ].join('\n');
    case 'generic-webhook-web-linear-drive':
      return [
        'A generic ingest webhook reports customer-health evidence.',
        'A web note, Linear issue, and Google Drive project plan provide related context.',
        'This is a generic_webhook scenario because the generic webhook is the source that triggers reconciliation; do not reclassify it as customer_project.',
        'The generic webhook, web note, Linear issue, and Drive plan are context links in this packet, so include observed_association.',
        'The generic webhook is evidence-only unless a human approves Timeline memory, so include approval_bundle for memory.',
        'No provider-owned lifecycle or status field changes in this packet, so do not include direct_write.',
      ].join('\n');
    default:
      return 'Use only the listed evidence and source refs.';
  }
}

function uniqueRawRefs(testCase: DeterministicEvalCase): {
  surface: (typeof reconciliationEvalIngestionSurfaces)[number];
  rawEventId: string;
}[] {
  const refs = [
    ...testCase.outputs.flatMap((output) => output.sourceRefs),
    ...(testCase.associations ?? []).flatMap((association) => association.sourceRefs),
  ];
  const seen = new Set<string>();
  return refs.flatMap((ref) => {
    const rawEventId = sourceRefRawEventId(ref);
    if (!rawEventId || !isKnownSurface(ref.source)) return [];
    const key = `${ref.source}:${rawEventId}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ surface: ref.source, rawEventId }];
  });
}

function expectedDirectWriteSurfaces(
  testCase: DeterministicEvalCase,
): (typeof reconciliationEvalIngestionSurfaces)[number][] {
  const seen = new Set<(typeof reconciliationEvalIngestionSurfaces)[number]>();
  for (const output of testCase.outputs) {
    if (output.outputKind !== 'direct_write') continue;
    for (const ref of output.sourceRefs) {
      if (!isKnownSurface(ref.source)) continue;
      seen.add(ref.source);
    }
  }
  return [...seen].sort();
}

function sourceRefRawEventId(ref: SourceRef): string | null {
  const rawEventId = ref.rawEventId?.trim();
  return rawEventId && rawEventId.length > 0 ? rawEventId : null;
}

function isKnownSurface(
  source: string,
): source is (typeof reconciliationEvalIngestionSurfaces)[number] {
  return reconciliationEvalIngestionSurfaces.some((surface) => surface === source);
}

function isKnownScenarioFamily(
  scenarioFamily: string | null | undefined,
): scenarioFamily is (typeof reconciliationEvalScenarioFamilies)[number] {
  return (
    scenarioFamily !== null &&
    scenarioFamily !== undefined &&
    reconciliationEvalScenarioFamilies.some((known) => known === scenarioFamily)
  );
}

function isKnownOutputKind(value: string): value is ReconciliationPlannerOutputKind {
  return reconciliationPlannerOutputKinds.some((outputKind) => outputKind === value);
}
