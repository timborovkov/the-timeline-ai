/** Operator-only local reset. Stop the development web server before --confirm. */
import { getDb, closeDb } from '@timeline/db';
import { queue, suggestions, llm, qdrant, withTeam } from '@timeline/shared';
import { closeAllRedisConnections } from '@timeline/shared/redis';
import { Queue } from 'bullmq';

export async function removeQueuedDevelopmentJobs(
  q: Queue<{ teamId?: string }>,
  teamId: string,
): Promise<void> {
  const client = queue.getRedisConnection();
  const pausedIds = await client.lrange(q.toKey('paused'), 0, -1);
  const jobs = [
    ...(await q.getJobs(['wait', 'delayed', 'failed', 'prioritized', 'waiting-children'], 0, -1)),
    ...(await Promise.all(pausedIds.map((id) => q.getJob(id)))),
  ];
  const seen = new Set<string>();
  for (const job of jobs)
    if (job?.id && !seen.has(job.id) && job.data.teamId === teamId) {
      seen.add(job.id);
      await job.remove();
    }
}

async function main() {
  suggestions.assertDevelopmentResetEnvironment(process.env);
  const args = process.argv.slice(2);
  const teamId = args.find((arg) => arg.startsWith('--team='))?.slice(7);
  if (!teamId || !/^[a-f0-9-]{36}$/i.test(teamId)) throw new Error('Supply --team=<uuid>');
  const scope = withTeam(getDb(), teamId, '00000000-0000-0000-0000-000000000000', {
    skipMembershipCheck: true,
  });
  let inventory = await scope.engineMaintenance.resetInventory();
  console.log({
    teamId,
    objects: inventory.objects.length,
    facts: inventory.facts.length,
    notes: inventory.notes.length,
    changes: inventory.changes.length,
  });
  if (!args.includes(`--confirm=${teamId}`)) {
    console.log(
      'Dry run. Stop the development web server, then use --offline --confirm=<team UUID>. Object edits and approval history will be discarded; captured sources are preserved.',
    );
    return;
  }
  if (!args.includes('--offline'))
    throw new Error('--offline confirms development web/ingest writers are stopped');
  const queues = Object.values(queue.QUEUE_NAMES).map(
    (name) => new Queue<{ teamId?: string }>(name, { connection: queue.getRedisConnection() }),
  );
  const paused: Queue[] = [];
  const redis = queue.getRedisConnection();
  const resetToken = crypto.randomUUID();
  const resetLock = 'timeline:development-object-reset';
  if (!(await redis.set(resetLock, resetToken, 'PX', 60_000, 'NX')))
    throw new Error('Another development reset is running');
  const lockState = { lost: false };
  const heartbeat = setInterval(() => {
    void redis
      .eval(
        "if redis.call('get',KEYS[1]) == ARGV[1] then return redis.call('pexpire',KEYS[1],60000) else return 0 end",
        1,
        resetLock,
        resetToken,
      )
      .then(async (value) => {
        if (!value) lockState.lost = true;
        if (runLease) await scope.engineMaintenance.renewRun(runLease.id, runLease.token);
      })
      .catch(() => {
        lockState.lost = true;
      });
  }, 15_000);
  let runLease: { id: string; token: string } | null = null;
  let replayFinished = false;
  try {
    const run = await scope.engineMaintenance.beginCleanup('development_reset');
    const token = await scope.engineMaintenance.claimRun(run.id);
    if (!token) throw new Error('Reset run is already owned by another process');
    runLease = { id: run.id, token };
    const checkpoint = (input: Parameters<typeof scope.engineMaintenance.checkpoint>[1]) =>
      scope.engineMaintenance.checkpoint(run.id, input, token);
    const metadata = (run.metadata ?? {}) as Record<string, unknown>;
    const queuesToResume = Array.isArray(metadata.queuesToResume)
      ? metadata.queuesToResume.filter((name): name is string => typeof name === 'string')
      : (await Promise.all(queues.map(async (q) => ((await q.isPaused()) ? null : q.name)))).filter(
          (name): name is string => name !== null,
        );
    await checkpoint({ status: 'running', metadata: { queuesToResume } });
    for (const q of queues) {
      if (queuesToResume.includes(q.name)) paused.push(q);
      await q.pause();
    }
    for (const q of queues)
      if (await q.getActiveCount())
        throw new Error(
          'Workers still have active jobs. Wait for them to finish and retry; no reset was performed.',
        );
    if (!metadata.phase) {
      inventory = await scope.engineMaintenance.resetInventory();
      // Remove queued team jobs that carry stale object IDs before deleting their targets.
      for (const q of queues) await removeQueuedDevelopmentJobs(q, teamId);
      const vectors = qdrant.getQdrantClient();
      for (const [kind, rows] of [
        ['object', inventory.objects],
        ['entity', inventory.objects],
        ['fact', inventory.facts],
        ['object_note', inventory.notes],
        ['object_change', inventory.changes],
      ] as const) {
        for (const row of rows)
          for (const model of new Set([
            llm.TIMELINE_MODELS.embedding.id,
            'openai/text-embedding-3-small',
          ])) {
            if (lockState.lost) throw new Error('Development reset lock lost');
            await vectors.deletePointsForSource({
              teamId,
              scope: kind,
              sourceId: row.id,
              model,
              verifyDeleted: true,
            });
            await vectors.deletePoints([qdrant.buildPointId(kind, row.id, model)], {
              verifyDeleted: true,
            });
          }
      }
      if (lockState.lost) throw new Error('Development reset lock lost');
      await scope.engineMaintenance.resetDerivedState(run.id);
    }
    let cursor = metadata.phase === 'replay_events' ? run.cursor : null;
    let examined = metadata.phase === 'replay_events' ? run.examined : 0;
    while (metadata.phase !== 'replay_enqueued') {
      const page = await scope.engineMaintenance.replayEvents(cursor);
      if (!page.length) break;
      for (const event of page) {
        if (event.source !== 'document') {
          await queue.enqueueExtractJob({ teamId, rawEventId: event.id });
          await queue.enqueueSuggestionJob(
            { teamId, rawEventId: event.id },
            { jobIdSuffix: run.id },
          );
        }
        cursor = event.id;
        examined++;
        await checkpoint({
          cursor,
          examined,
          status: 'running',
          metadata: { phase: 'replay_events' },
        });
      }
    }
    for (const version of await scope.engineMaintenance.replayDocuments())
      await queue.enqueueDocumentExtractJob({ teamId, documentVersionId: version.id });
    await checkpoint({ status: 'running', examined, metadata: { phase: 'replay_enqueued' } });
    replayFinished = true;
    console.log({ runId: run.id, replayEventsEnqueued: examined, status: 'replay_enqueued' });
  } finally {
    clearInterval(heartbeat);
    if (!lockState.lost) for (const q of paused) await q.resume();
    if (runLease) {
      if (replayFinished && !lockState.lost)
        await scope.engineMaintenance.checkpoint(
          runLease.id,
          { status: 'completed' },
          runLease.token,
        );
      await scope.engineMaintenance.releaseRun(runLease.id, runLease.token);
    }
    await redis.eval(
      "if redis.call('get',KEYS[1]) == ARGV[1] then return redis.call('del',KEYS[1]) else return 0 end",
      1,
      resetLock,
      resetToken,
    );
    for (const q of queues) await q.close();
  }
}
if (import.meta.main) {
  try {
    await main();
  } finally {
    await closeDb();
    await closeAllRedisConnections();
  }
}
