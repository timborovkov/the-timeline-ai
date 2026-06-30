import { describe, expect, it } from 'vitest';

import type { ChatStructuredInput, ChatStructuredResult } from '#src/llm/chat.js';
import type { z } from 'zod';

import {
  RECONCILIATION_PLANNER_PROMPT_VERSION,
  buildReconciliationPlannerPrompt,
  planReconciliation,
  reconciliationPlannerResultSchema,
  type ReconciliationPlannerResult,
} from '#src/reconciliation/planner.js';

describe('reconciliation planner', () => {
  it('builds a policy prompt with surfaces, source refs, and authority guardrails', () => {
    const prompt = buildReconciliationPlannerPrompt({
      packetName: 'customer-project-email-monday-sentry',
      observedSurfaces: ['email', 'monday', 'sentry'],
      sourceRefs: [
        { surface: 'email', rawEventId: 'raw-email-1' },
        { surface: 'monday', rawEventId: 'raw-monday-1' },
      ],
      plannerContext: [
        'A forwarded customer email ties Nora at Acme to a blocked implementation project.',
        'A Monday board item updates provider-owned project-board state.',
      ].join('\n'),
      policyDerivedScenarioFamily: 'customer_project',
      policyDerivedOutputKinds: ['observed_association', 'direct_write', 'approval_bundle'],
      policyDerivedDirectWriteSurfaces: ['monday', 'sentry'],
      policyDerivedArtifactClusterKinds: ['customer_project', 'provider_record', 'incident'],
    });

    expect(RECONCILIATION_PLANNER_PROMPT_VERSION).toBe(
      'reconciliation-planner-2026-06-privacy-floor',
    );
    expect(prompt).toContain('Evidence packet: customer-project-email-monday-sentry');
    expect(prompt).toContain('- email');
    expect(prompt).toContain('- monday: raw-monday-1');
    expect(prompt).toContain(
      'Policy-derived direct-write surfaces for this packet: monday, sentry',
    );
    expect(prompt).toContain(
      'Policy-derived artifact cluster kinds for this packet: customer_project, provider_record, incident',
    );
    expect(prompt).toContain('ingestionSurfaces result must be a subset of Observed surfaces');
    expect(prompt).toContain('Use direct_write only when the planner context explicitly says');
    expect(prompt).toContain('policy-derived output kind set as required minimum categories');
    expect(prompt).toContain('provider direct writes do not replace human approval');
    expect(prompt).toContain('directWriteSurfaces must list every observed surface');
    expect(prompt).toContain('Do not collapse provider_record into customer_project');
    expect(prompt).toContain('Never use direct_write for Timeline-owned company');
    expect(prompt).toContain('Do not omit approval_bundle');
    expect(prompt).toContain('Privacy risk means visibility broadening');
    expect(prompt).toContain('Return every listed raw source ref exactly once');
  });

  it('calls structured chat with the planner schema and returns the model result', async () => {
    const controller = new AbortController();
    const calls: ChatStructuredInput<typeof reconciliationPlannerResultSchema>[] = [];
    const object: ReconciliationPlannerResult = {
      scenarioFamily: 'incident_response',
      ingestionSurfaces: ['sentry', 'github', 'slack', 'email'],
      outputKinds: ['direct_write', 'observed_association', 'approval_bundle'],
      directWriteSurfaces: ['sentry'],
      artifactClusterKinds: ['incident', 'task', 'account'],
      approvalRequired: true,
      sourceRefs: [
        { surface: 'sentry', rawEventId: 'raw-sentry-resolved' },
        { surface: 'github', rawEventId: 'raw-github-pr' },
      ],
      privacyRisk: false,
    };
    const chatStructured = <TSchema extends z.ZodType>(
      input: ChatStructuredInput<TSchema>,
    ): Promise<ChatStructuredResult<TSchema>> => {
      calls.push(input as unknown as ChatStructuredInput<typeof reconciliationPlannerResultSchema>);
      return Promise.resolve({
        object: input.schema.parse(object),
        model: input.model ?? 'test-model',
      });
    };

    await expect(
      planReconciliation(
        {
          packetName: 'incident-response-sentry-github-slack-email',
          observedSurfaces: ['sentry', 'github', 'slack', 'email'],
          sourceRefs: [
            { surface: 'sentry', rawEventId: 'raw-sentry-resolved' },
            { surface: 'github', rawEventId: 'raw-github-pr' },
          ],
          plannerContext: 'Sentry owns the incident lifecycle signal.',
          policyDerivedScenarioFamily: 'incident_response',
          policyDerivedOutputKinds: ['direct_write', 'observed_association', 'approval_bundle'],
          model: 'test-planner-model',
          abortSignal: controller.signal,
        },
        { chatStructured },
      ),
    ).resolves.toEqual(object);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      schema: reconciliationPlannerResultSchema,
      model: 'test-planner-model',
      abortSignal: controller.signal,
    });
    expect(calls[0]?.prompt).toContain('Sentry owns the incident lifecycle signal.');
  });
});
