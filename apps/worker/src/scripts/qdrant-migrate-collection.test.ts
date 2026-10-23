import { type qdrant } from '@timeline/shared';
import { describe, expect, it, vi } from 'vitest';

import {
  parseArgs,
  QdrantMigrateUsageError,
  runQdrantMigrateCollection,
} from '#src/scripts/qdrant-migrate-collection.js';

type QdrantClient = qdrant.QdrantClient;

const TEAM = '20000000-0000-4000-8000-000000000001';
const USER = '10000000-0000-4000-8000-000000000001';

function fakeClient(
  name: string,
  points = 2,
): {
  client: QdrantClient;
  ensureCollection: ReturnType<typeof vi.fn>;
  upsertPoints: ReturnType<typeof vi.fn>;
  collectionInfo: ReturnType<typeof vi.fn>;
  search: ReturnType<typeof vi.fn>;
} {
  const ensureCollection = vi.fn().mockResolvedValue(undefined);
  const upsertPoints = vi.fn().mockResolvedValue(undefined);
  const collectionInfo = vi.fn().mockResolvedValue({
    result: {
      points_count: points,
      config: {
        params: {
          on_disk_payload: true,
          vectors: { on_disk: true, size: 4 },
          quantization_config: { scalar: { type: 'int8' } },
        },
      },
    },
  });
  const search = vi.fn().mockResolvedValue([{ id: 'p1', score: 1, payload: {} }]);
  const client = {
    collectionName: () => name,
    ensureCollection,
    countAllPoints: vi.fn().mockResolvedValue(points),
    scrollPoints: vi.fn().mockResolvedValue({
      points: [
        {
          id: 'p1',
          vector: [0.1, 0.2, 0.3, 0.4],
          payload: { team_id: TEAM, visibility: 'team' },
        },
      ],
      nextOffset: null,
    }),
    upsertPoints,
    collectionInfo,
    metricsText: vi
      .fn()
      .mockResolvedValue(`collection_data_ram_size_bytes{collection="${name}"} 100\n`),
    search,
  } as unknown as QdrantClient;
  return { client, ensureCollection, upsertPoints, collectionInfo, search };
}

describe('qdrant-migrate-collection CLI', () => {
  it('parses the copy/verify flow used by the documented cutover', () => {
    expect(
      parseArgs([
        '--source-collection=events',
        '--target-collection=events_ondisk',
        '--create-target',
        '--copy',
        '--verify',
      ]),
    ).toMatchObject({
      sourceCollection: 'events',
      targetCollection: 'events_ondisk',
      createTarget: true,
      copy: true,
      verify: true,
      dryRun: false,
    });
  });

  it('rejects missing actions, identical collections, and production-unsafe measure flags', () => {
    expect(() =>
      parseArgs(['--source-collection=events', '--target-collection=events_ondisk']),
    ).toThrow(QdrantMigrateUsageError);
    expect(() =>
      parseArgs(['--source-collection=events', '--target-collection=events', '--copy']),
    ).toThrow(/must differ/);
    expect(() =>
      parseArgs(['--source-collection=events', '--target-collection=events_ondisk', '--measure']),
    ).toThrow(/--team=/);
  });

  it('creates the target, copies points, and verifies counts', async () => {
    const source = fakeClient('events', 2);
    const targetCreate = fakeClient('events_ondisk', 0);
    const target = fakeClient('events_ondisk', 2);
    const clients = [source.client, targetCreate.client, target.client];
    const write = vi.fn();
    const setExitCode = vi.fn();

    await runQdrantMigrateCollection(
      {
        sourceCollection: 'events',
        targetCollection: 'events_ondisk',
        createTarget: true,
        copy: true,
        verify: true,
        measure: false,
        dryRun: false,
        pageSize: 64,
        recallSample: 8,
        recallK: 5,
      },
      {
        env: { NODE_ENV: 'development' },
        createClient: () => {
          const client = clients.shift();
          if (!client) throw new Error('unexpected extra client');
          return client;
        },
        write,
        setExitCode,
      },
    );

    expect(targetCreate.ensureCollection).toHaveBeenCalledOnce();
    expect(target.upsertPoints).toHaveBeenCalled();
    const output = JSON.parse(write.mock.calls[0]?.[0] as string) as {
      verify: { matched: boolean };
      copy: { upserted: number };
    };
    expect(output.copy.upserted).toBe(1);
    expect(output.verify.matched).toBe(true);
    expect(setExitCode).not.toHaveBeenCalled();
  });

  it('refuses to run against production', async () => {
    await expect(
      runQdrantMigrateCollection(
        {
          sourceCollection: 'events',
          targetCollection: 'events_ondisk',
          createTarget: false,
          copy: true,
          verify: false,
          measure: false,
          dryRun: true,
          pageSize: 64,
          recallSample: 8,
          recallK: 5,
        },
        {
          env: { NODE_ENV: 'production' },
          createClient: () => fakeClient('events').client,
        },
      ),
    ).rejects.toThrow(/NODE_ENV=production/);
  });

  it('dry-run create+copy does not ensure or upsert the target', async () => {
    const source = fakeClient('events', 1);
    const target = fakeClient('events_ondisk', 0);
    const write = vi.fn();

    await runQdrantMigrateCollection(
      {
        sourceCollection: 'events',
        targetCollection: 'events_ondisk',
        createTarget: true,
        copy: true,
        verify: true,
        measure: false,
        dryRun: true,
        pageSize: 64,
        recallSample: 8,
        recallK: 5,
      },
      {
        env: { NODE_ENV: 'development' },
        createClient: (opts) => (opts.collection === 'events' ? source.client : target.client),
        write,
      },
    );

    expect(target.ensureCollection).not.toHaveBeenCalled();
    expect(target.upsertPoints).not.toHaveBeenCalled();
    const output = JSON.parse(write.mock.calls[0]?.[0] as string) as {
      targetCreated: string;
      verify: string;
      copy: { dryRun: boolean; upserted: number };
    };
    expect(output.targetCreated).toBe('dry-run');
    expect(output.verify).toBe('dry-run');
    expect(output.copy).toMatchObject({ dryRun: true, upserted: 1 });
  });

  it('measures source and target RAM/recall after a live copy', async () => {
    const source = fakeClient('events', 1);
    const targetCreate = fakeClient('events_ondisk', 0);
    const target = fakeClient('events_ondisk', 1);
    const clients = [source.client, targetCreate.client, target.client];
    const write = vi.fn();

    await runQdrantMigrateCollection(
      {
        sourceCollection: 'events',
        targetCollection: 'events_ondisk',
        createTarget: true,
        copy: true,
        verify: false,
        measure: true,
        dryRun: false,
        pageSize: 64,
        recallSample: 8,
        recallK: 5,
        teamId: TEAM,
        userId: USER,
      },
      {
        env: { NODE_ENV: 'development' },
        createClient: () => {
          const client = clients.shift();
          if (!client) throw new Error('unexpected extra client');
          return client;
        },
        write,
      },
    );

    expect(source.collectionInfo).toHaveBeenCalled();
    expect(target.collectionInfo).toHaveBeenCalled();
    expect(source.search).toHaveBeenCalled();
    expect(target.search).toHaveBeenCalled();
    const output = JSON.parse(write.mock.calls[0]?.[0] as string) as {
      ram: { source?: unknown; target?: unknown };
      recall: { source?: { meanRecall: number }; target?: { meanRecall: number } };
    };
    expect(output.ram.source).toBeDefined();
    expect(output.ram.target).toBeDefined();
    expect(output.recall.source?.meanRecall).toBe(1);
    expect(output.recall.target?.meanRecall).toBe(1);
  });

  it('requires team and user when measuring recall', () => {
    expect(
      parseArgs([
        '--source-collection=events',
        '--target-collection=events_ondisk',
        '--measure',
        `--team=${TEAM}`,
        `--user=${USER}`,
      ]),
    ).toMatchObject({ measure: true, teamId: TEAM, userId: USER });
  });
});
