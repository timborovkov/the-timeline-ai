import { createHash, randomUUID } from 'node:crypto';

import { auditLog, evaluationTraceProjects, rawEvents, teams, type Db } from '@timeline/db';
import { and, count, eq, gt, inArray, lte, or, sql } from 'drizzle-orm';
import { Client } from 'langsmith/client';

import { getEnv } from '#src/env.js';
import { EVALUATION_CONSENT_VERSION, evaluationSource } from '#src/evaluation-tracing/contract.js';
import { rawEventIsActive } from '#src/visibility.js';

export interface EvaluationTicket {
  revision: string;
  eventIds: string[];
  startedAt: number;
}
export interface ExtractionTrace {
  prompt: string;
  instructions: string;
  model: string;
  output?: unknown;
  failed?: boolean;
}
export interface EvaluationTransport {
  send: (
    name: string,
    id: string,
    ticket: EvaluationTicket,
    trace: ExtractionTrace,
  ) => Promise<void>;
  remove: (name: string) => Promise<void>;
}
function transport(endpoint: string, workspaceId: string): EvaluationTransport {
  const apiKey = getEnv().LANGSMITH_API_KEY;
  if (!apiKey) throw new Error('Evaluation credentials unavailable');
  const client = new Client({
    apiKey,
    apiUrl: endpoint,
    workspaceId,
    autoBatchTracing: false,
    tracingSamplingRate: 1,
    timeout_ms: 5000,
    callerOptions: { maxRetries: 0 },
    debug: false,
    omitTracedRuntimeInfo: true,
  });
  return {
    send: (name, id, ticket, trace) =>
      client.createRun({
        id,
        trace_id: id,
        name: 'source-extraction',
        run_type: 'llm',
        project_name: name,
        start_time: ticket.startedAt,
        end_time: Date.now(),
        inputs: { prompt: trace.prompt, instructions: trace.instructions },
        outputs: trace.failed ? {} : { result: trace.output },
        ...(trace.failed ? { error: 'Inference failed' } : {}),
        extra: {
          metadata: {
            consent_version: EVALUATION_CONSENT_VERSION,
            ls_provider: 'openrouter',
            ls_model_name: trace.model,
            prompt_version: createHash('sha256').update(trace.instructions).digest('hex'),
            operation: 'source-extraction',
            synthetic: false,
          },
        },
      }),
    async remove(name) {
      // Only projects owned by our deletion inventory reach this method.
      const projects = [];
      for await (const project of client.listProjects({ name }))
        if (project.name === name) projects.push(project);
      for (const project of projects) await client.deleteProject({ projectId: project.id });
      // Deletion can be asynchronous: retain inventory until absence is observed.
      for await (const project of client.listProjects({ name }))
        if (project.name === name) throw new Error('Provider deletion pending');
    },
  };
}
function available() {
  const env = getEnv();
  return Boolean(
    env.WORKSPACE_EVALUATION_TRACING_READY && env.LANGSMITH_API_KEY && env.LANGSMITH_WORKSPACE_ID,
  );
}

/** Called only by the named workspace scope and the source-extraction worker. */
export function createEvaluationCaptureScope(
  db: Db,
  teamId: string,
  ensureMember: () => Promise<unknown>,
  io?: EvaluationTransport,
) {
  async function eligible(store: Pick<Db, 'select'>, ids: string[], lock = false) {
    if (!ids.length || ids.length > 6 || new Set(ids).size !== ids.length) return null;
    const query = store.select().from(teams).where(eq(teams.id, teamId));
    const [team] = await (lock ? query.for('update') : query);
    const pref = team?.evaluationTracing;
    if (
      !team ||
      team.disabledAt ||
      team.deletionStartedAt ||
      !pref?.enabled ||
      pref.policyVersion !== EVALUATION_CONSENT_VERSION
    )
      return null;
    const eventsQuery = store
      .select({ source: rawEvents.source, metadata: rawEvents.sourceMetadata })
      .from(rawEvents)
      .where(
        and(
          eq(rawEvents.teamId, teamId),
          inArray(rawEvents.id, ids),
          eq(rawEvents.visibility, 'team'),
          rawEventIsActive(),
        ),
      );
    const events = await (lock ? eventsQuery.for('share') : eventsQuery);
    if (
      events.length !== ids.length ||
      events.some((e) => !pref.sources.includes(evaluationSource(e.source, e.metadata) ?? ''))
    )
      return null;
    return pref;
  }
  async function begin(eventIds: string[]): Promise<EvaluationTicket | null> {
    await ensureMember();
    if (!available()) return null;
    // Stable 10% sampling; retries cannot increase the sampling probability.
    if (
      createHash('sha256')
        .update(eventIds[0] ?? '')
        .digest()
        .readUInt32BE(0) %
        10 !==
      0
    )
      return null;
    const preference = await eligible(db, eventIds);
    return preference ? { revision: preference.revision, eventIds, startedAt: Date.now() } : null;
  }
  async function finish(ticket: EvaluationTicket | null, trace: ExtractionTrace) {
    if (!ticket || !available()) return;
    await ensureMember();
    if (
      Date.now() - ticket.startedAt > 15 * 60_000 ||
      Buffer.byteLength(JSON.stringify(trace)) > 100_000
    )
      return;
    const env = getEnv();
    const endpoint = env.LANGSMITH_ENDPOINT;
    const workspaceId = env.LANGSMITH_WORKSPACE_ID;
    if (!workspaceId) return;
    // Persist cleanup inventory BEFORE the network call, including ambiguous timeouts.
    const destination = createHash('sha256')
      .update(`${endpoint}|${workspaceId}`)
      .digest('hex')
      .slice(0, 12);
    const name = `timeline-opt-in-${destination}-${teamId}-${ticket.revision}-${new Date(ticket.startedAt).toISOString().slice(0, 10)}`;
    await db
      .insert(evaluationTraceProjects)
      .values({
        teamId,
        name,
        endpoint,
        workspaceId,
        expiresAt: new Date(ticket.startedAt + 30 * 86400_000),
        reconcileAfter: new Date(Date.now() + 48 * 3600_000),
      })
      .onConflictDoUpdate({
        target: evaluationTraceProjects.name,
        set: { reconcileAfter: new Date(Date.now() + 48 * 3600_000) },
      });
    await db.transaction(async (tx) => {
      const preference = await eligible(tx, ticket.eventIds, true);
      if (preference?.revision !== ticket.revision || !available()) return;
      const [project] = await tx
        .select()
        .from(evaluationTraceProjects)
        .where(
          and(eq(evaluationTraceProjects.teamId, teamId), eq(evaluationTraceProjects.name, name)),
        )
        .for('update');
      if (!project || project.expiresAt.getTime() <= Date.now()) return;
      const [quota] = await tx
        .select({ total: count() })
        .from(auditLog)
        .where(
          and(
            eq(auditLog.teamId, teamId),
            eq(auditLog.action, 'evaluation_tracing.export'),
            gt(auditLog.createdAt, sql`now() - interval '1 day'`),
          ),
        );
      if ((quota?.total ?? 0) >= 100) return;
      const id = randomUUID();
      let status = 'sent';
      try {
        await (io ?? transport(endpoint, workspaceId)).send(name, id, ticket, trace);
      } catch {
        status = 'unconfirmed';
      } // Never log provider errors, prompts, or outputs.
      await tx.insert(auditLog).values({
        teamId,
        action: 'evaluation_tracing.export',
        targetType: 'evaluation_trace',
        targetId: id,
        metadata: { status, consentVersion: EVALUATION_CONSENT_VERSION },
      });
    });
  }
  return { begin, finish };
}

/** Bounded provider cleanup. Does not depend on the capture-ready flag. */
export async function pruneEvaluationTraces(db: Db, teamId?: string, io?: EvaluationTransport) {
  const rows = await db
    .select({ id: evaluationTraceProjects.id, teamId: evaluationTraceProjects.teamId })
    .from(evaluationTraceProjects)
    .innerJoin(teams, eq(teams.id, evaluationTraceProjects.teamId))
    .where(
      and(
        lte(evaluationTraceProjects.nextCleanupAt, new Date()),
        teamId ? eq(teams.id, teamId) : undefined,
        or(
          lte(evaluationTraceProjects.expiresAt, new Date()),
          sql`${teams.deletionStartedAt} is not null`,
          sql`${teams.disabledAt} is not null`,
          sql`${teams.evaluationTracing}->>'enabled' = 'false'`,
        ),
      ),
    )
    .orderBy(evaluationTraceProjects.nextCleanupAt)
    .limit(50);
  let failed = 0;
  for (const row of rows) {
    try {
      await db.transaction(async (tx) => {
        // Same lock order as capture/configuration.
        await tx.select({ id: teams.id }).from(teams).where(eq(teams.id, row.teamId)).for('update');
        const [project] = await tx
          .select()
          .from(evaluationTraceProjects)
          .where(eq(evaluationTraceProjects.id, row.id))
          .for('update');
        if (!project || (!io && !getEnv().LANGSMITH_API_KEY)) return;
        await (io ?? transport(project.endpoint, project.workspaceId)).remove(project.name);
        if (project.reconcileAfter.getTime() <= Date.now()) {
          await tx
            .delete(evaluationTraceProjects)
            .where(eq(evaluationTraceProjects.id, project.id));
        } else {
          await tx
            .update(evaluationTraceProjects)
            .set({ nextCleanupAt: new Date(Date.now() + 3600_000) })
            .where(eq(evaluationTraceProjects.id, project.id));
        }
      });
    } catch {
      failed += 1;
      await db
        .update(evaluationTraceProjects)
        .set({ nextCleanupAt: new Date(Date.now() + 3600_000) })
        .where(eq(evaluationTraceProjects.id, row.id));
    }
  }
  return { attempted: rows.length, failed };
}
