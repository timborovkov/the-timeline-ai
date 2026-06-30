import { z } from 'zod';

import { chatStructured as defaultChatStructured } from '#src/llm/chat.js';
import { TIMELINE_MODELS } from '#src/llm/models.js';
import {
  artifactClusterKinds,
  reconciliationEvalIngestionSurfaces,
  reconciliationEvalScenarioFamilies,
  type ArtifactClusterKind,
  type ReconciliationEvalIngestionSurface,
  type ReconciliationEvalScenarioFamily,
} from '#src/reconciliation/index.js';

export const RECONCILIATION_PLANNER_PROMPT_VERSION = 'reconciliation-planner-2026-06-privacy-floor';

export const reconciliationPlannerOutputKinds = [
  'observed_association',
  'direct_write',
  'approval_bundle',
  'no_action',
  'conflict',
] as const;

export type ReconciliationPlannerOutputKind = (typeof reconciliationPlannerOutputKinds)[number];

export interface ReconciliationPlannerSourceRef {
  surface: ReconciliationEvalIngestionSurface;
  rawEventId: string;
}

export interface ReconciliationPlannerInput {
  packetName: string;
  observedSurfaces: ReconciliationEvalIngestionSurface[];
  sourceRefs: ReconciliationPlannerSourceRef[];
  plannerContext: string;
  scenarioFamilyCandidates?: readonly ReconciliationEvalScenarioFamily[];
  ingestionSurfaceCandidates?: readonly ReconciliationEvalIngestionSurface[];
  policyDerivedScenarioFamily?: ReconciliationEvalScenarioFamily | null;
  policyDerivedOutputKinds?: readonly ReconciliationPlannerOutputKind[];
  policyDerivedDirectWriteSurfaces?: readonly ReconciliationEvalIngestionSurface[];
  policyDerivedArtifactClusterKinds?: readonly ArtifactClusterKind[];
  model?: string;
  abortSignal?: AbortSignal;
}

export interface ReconciliationPlannerResult {
  scenarioFamily: ReconciliationEvalScenarioFamily;
  ingestionSurfaces: ReconciliationEvalIngestionSurface[];
  outputKinds: ReconciliationPlannerOutputKind[];
  directWriteSurfaces: ReconciliationEvalIngestionSurface[];
  artifactClusterKinds: ArtifactClusterKind[];
  approvalRequired: boolean;
  sourceRefs: ReconciliationPlannerSourceRef[];
  privacyRisk: boolean;
}

export interface ReconciliationPlannerDeps {
  chatStructured?: typeof defaultChatStructured;
}

export const reconciliationPlannerResultSchema = z.object({
  scenarioFamily: z.enum(reconciliationEvalScenarioFamilies),
  ingestionSurfaces: z.array(z.enum(reconciliationEvalIngestionSurfaces)),
  outputKinds: z.array(z.enum(reconciliationPlannerOutputKinds)),
  directWriteSurfaces: z.array(z.enum(reconciliationEvalIngestionSurfaces)),
  artifactClusterKinds: z.array(z.enum(artifactClusterKinds)),
  approvalRequired: z.boolean(),
  sourceRefs: z.array(
    z.object({
      surface: z.enum(reconciliationEvalIngestionSurfaces),
      rawEventId: z.string(),
    }),
  ),
  privacyRisk: z.boolean(),
});

export async function planReconciliation(
  input: ReconciliationPlannerInput,
  deps: ReconciliationPlannerDeps = {},
): Promise<ReconciliationPlannerResult> {
  const chatStructured = deps.chatStructured ?? defaultChatStructured;
  const result = await chatStructured({
    schema: reconciliationPlannerResultSchema,
    model: input.model ?? TIMELINE_MODELS.summarization.id,
    system:
      'You are evaluating a workspace reconciliation planner. Return concise JSON only. Do not invent unsupported facts.',
    prompt: buildReconciliationPlannerPrompt(input),
    ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
  });
  return result.object;
}

export function buildReconciliationPlannerPrompt(input: ReconciliationPlannerInput): string {
  const scenarioFamilyCandidates =
    input.scenarioFamilyCandidates ?? reconciliationEvalScenarioFamilies;
  const ingestionSurfaceCandidates =
    input.ingestionSurfaceCandidates ?? reconciliationEvalIngestionSurfaces;

  return `
Evidence packet: ${input.packetName}
Scenario family candidates: ${scenarioFamilyCandidates.join(', ')}
Ingestion surface candidates: ${ingestionSurfaceCandidates.join(', ')}
Policy-derived scenario family for this packet: ${input.policyDerivedScenarioFamily ?? 'unknown'}
Policy-derived output kind set for this packet: ${(input.policyDerivedOutputKinds ?? []).join(', ')}
Policy-derived direct-write surfaces for this packet: ${(input.policyDerivedDirectWriteSurfaces ?? []).join(', ')}
Policy-derived artifact cluster kinds for this packet: ${(input.policyDerivedArtifactClusterKinds ?? []).join(', ')}

Observed surfaces:
${input.observedSurfaces.map((surface) => `- ${surface}`).join('\n')}

Raw source refs:
${input.sourceRefs.map((ref) => `- ${ref.surface}: ${ref.rawEventId}`).join('\n')}

Planner context:
${input.plannerContext}

Task:
Classify the scenario family and ingestion surfaces.
The ingestionSurfaces result must be a subset of Observed surfaces. Do not add candidate surfaces that are not listed under Observed surfaces.
List outputKinds as a unique set of planner category names, not one entry per source ref.
Treat the policy-derived output kind set as required minimum categories for this packet unless the planner context explicitly says a category is unsafe or impossible.
Include observed_association whenever evidence should attach to a cluster without changing canonical Timeline memory.
Use direct_write only when the planner context explicitly says a provider owns the target state being changed.
Never use direct_write for Timeline-owned company, person, project, task, note, decision, relationship, or customer-memory changes.
Mixed packets can require both direct_write for provider-owned state and approval_bundle for Timeline-owned memory; provider direct writes do not replace human approval for Timeline memory.
If outputKinds includes direct_write, directWriteSurfaces must list every observed surface whose evidence directly owns provider state for this packet.
Use the policy-derived direct-write surfaces as hints for directWriteSurfaces; do not leave directWriteSurfaces empty when those hints are present.
If outputKinds does not include direct_write, directWriteSurfaces must be empty.
Return artifactClusterKinds as the unique set of work-artifact cluster kinds needed by the packet.
Use the policy-derived artifact cluster kinds as required minimum categories unless the planner context explicitly says one is unsafe or impossible.
Do not collapse provider_record into customer_project, account, incident, or task. Provider records are work artifacts that preserve external Monday, Sentry, Linear, GitHub, Drive, or webhook records separately from durable Timeline memory.
Use approval_bundle for Timeline-owned company, person, project, task, note, decision, relationship, or customer-memory changes.
Do not omit approval_bundle just because the same packet also includes direct_write or observed_association.
Set approvalRequired to true exactly when outputKinds includes approval_bundle; otherwise set it to false.
Return every listed raw source ref exactly once in sourceRefs.
Set privacyRisk to true only if the planned output would expose private or specific-user evidence to a broader audience. The expected planner keeps each output at or below its visibility floor.
Set privacyRisk to false when private or specific-user evidence remains private or specific-user for the same audience. Privacy risk means visibility broadening, not the mere presence of private evidence.
All evidence is team-visible unless the planner context explicitly says it is private. Sensitive subject matter alone is not a privacy risk.
Do not include conflict unless the planner context explicitly says there is competing or contradictory evidence.
`;
}
