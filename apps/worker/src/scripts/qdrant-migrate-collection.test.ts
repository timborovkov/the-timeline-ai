import { type qdrant } from '@timeline/shared';
import { describe, expect, it, vi } from 'vitest';

import {
  parseArgs,
  QdrantMigrateUsageError,
  runQdrantMigrateCollection,
  type QdrantMigrateArgs,
} from '#src/scripts/qdrant-migrate-collection.js';

type QdrantClient = qdrant.QdrantClient;

const TEAM = '20000000-0000-4000-8000-000000000001';
const USER = '10000000-0000-4000-8000-000000000001';
const LOCAL_ENV = { NODE_ENV: 'development', QDRANT_URL: 'http://localhost:6333' };

function migrateArgs(overrides: Partial<QdrantMigrateArgs> = {}): QdrantMigrateArgs {
  return {
    sourceCollection: 'events',
    targetCollection: 'events_ondisk',
    createTarget: false,
    copy: false,
    verify: false,
    measure: false,
    dryRun: false,
    writersPaused: false,
    pageSize: 64,
    recallSample: 8,
    recallK: 5,
    ...overrides,
  };
}

function fakeClient(
  name: string,
  points = 2,
  opts: { layout?: 'ondisk' | 'inram'; searchHits?: { id: string; score: number }[] } = {},
): {
  client: QdrantClient;
  ensureCollection: ReturnType<typeof vi.fn>;
  upsertPoints: ReturnType<typeof vi.fn>;
  collectionInfo: ReturnType<typeof vi.fn>;
  collectionMemory: ReturnType<typeof vi.fn>;
  search: ReturnType<typeof vi.fn>;
  scrollPoints: ReturnType<typeof vi.fn>;
} {
  const layout = opts.layout ?? 'ondisk';
  const ensureCollection = vi.fn().mockResolvedValue(undefined);
  const upsertPoints = vi.fn().mockResolvedValue(undefined);
  const collectionInfo = vi.fn().mockResolvedValue({
    result: {
      points_count: points,
      config:
        layout === 'ondisk'
          ? {
              params: {
                on_disk_payload: true,
                vectors: { size: 1536, distance: 'Cosine', on_disk: true },
              },
              quantization_config: {
                scalar: { type: 'int8', quantile: 0.99, always_ram: true },
              },
            }
          : {
              params: {
                on_disk_payload: false,
                vectors: { size: 1536, distance: 'Cosine', on_disk: false },
              },
            },
    },
  });
  const collectionMemory = vi.fn().mockResolvedValue({
    result: {
      total: { ram_bytes: 100 },
      vectors: { ram_bytes: 80 },
      payload: { ram_bytes: 20 },
    },
  });
  const searchHits = opts.searchHits ?? [{ id: 'p1', score: 1 }];
  const search = vi.fn().mockResolvedValue(searchHits.map((hit) => ({ ...hit, payload: {} })));
  const scrollPoints = vi.fn().mockResolvedValue({
    points: [
      {
        id: 'p1',
        vector: [0.1, 0.2, 0.3, 0.4],
        payload: { team_id: TEAM, visibility: 'team', source_kind: 'raw_event', source_id: 'p1' },
      },
    ],
    nextOffset: null,
  });
  const client = {
    collectionName: () => name,
    ensureCollection,
    countAllPoints: vi.fn().mockResolvedValue(points),
    scrollPoints,
    upsertPoints,
    collectionInfo,
    collectionMemory,
    metricsText: vi.fn().mockResolvedValue(''),
    search,
  } as unknown as QdrantClient;
  return {
    client,
    ensureCollection,
    upsertPoints,
    collectionInfo,
    collectionMemory,
    search,
    scrollPoints,
  };
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
        '--writers-paused',
      ]),
    ).toMatchObject({
      sourceCollection: 'events',
      targetCollection: 'events_ondisk',
      createTarget: true,
      copy: true,
      verify: true,
      writersPaused: true,
      dryRun: false,
    });
  });

  it('rejects missing actions, identical collections, live copy without paused writers, and production-unsafe measure flags', () => {
    expect(() =>
      parseArgs(['--source-collection=events', '--target-collection=events_ondisk']),
    ).toThrow(QdrantMigrateUsageError);
    expect(() =>
      parseArgs(['--source-collection=events', '--target-collection=events', '--copy']),
    ).toThrow(/must differ/);
    expect(() =>
      parseArgs(['--source-collection=events', '--target-collection=events_ondisk', '--copy']),
    ).toThrow(/--writers-paused/);
    expect(() =>
      parseArgs(['--source-collection=events', '--target-collection=events_ondisk', '--measure']),
    ).toThrow(/--team=/);
  });

  it('creates the target, copies points, and verifies counts plus identity', async () => {
    const source = fakeClient('events', 2);
    const targetCreate = fakeClient('events_ondisk', 0);
    const target = fakeClient('events_ondisk', 2);
    const clients = [source.client, targetCreate.client, target.client];
    const write = vi.fn();
    const setExitCode = vi.fn();

    await runQdrantMigrateCollection(
      migrateArgs({ createTarget: true, copy: true, verify: true, writersPaused: true }),
      {
        env: LOCAL_ENV,
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
      verify: { matched: boolean; identity: { matched: boolean } };
      copy: { upserted: number; resync: { upserted: number } };
      targetLayout: string;
    };
    expect(output.copy.upserted).toBe(1);
    expect(output.copy.resync.upserted).toBe(1);
    expect(output.verify.matched).toBe(true);
    expect(output.verify.identity.matched).toBe(true);
    expect(output.targetLayout).toBe('ok');
    expect(setExitCode).not.toHaveBeenCalled();
  });

  it('refuses to run against production', async () => {
    await expect(
      runQdrantMigrateCollection(migrateArgs({ copy: true, dryRun: true }), {
        env: { NODE_ENV: 'production' },
        createClient: () => fakeClient('events').client,
      }),
    ).rejects.toThrow(/NODE_ENV=production/);
  });

  it('refuses a remote Qdrant URL even when the caller process is not production', async () => {
    await expect(
      runQdrantMigrateCollection(migrateArgs({ measure: true, teamId: TEAM, userId: USER }), {
        env: { NODE_ENV: 'development', QDRANT_URL: 'https://qdrant.example.com:6333' },
        createClient: () => fakeClient('events').client,
      }),
    ).rejects.toThrow(/non-loopback Qdrant host/);
  });

  it('dry-run create+copy does not ensure or upsert the target', async () => {
    const source = fakeClient('events', 1);
    const target = fakeClient('events_ondisk', 0);
    const write = vi.fn();

    await runQdrantMigrateCollection(
      migrateArgs({ createTarget: true, copy: true, verify: true, dryRun: true }),
      {
        env: LOCAL_ENV,
        createClient: (opts) => (opts.collection === 'events' ? source.client : target.client),
        write,
      },
    );

    expect(target.ensureCollection).not.toHaveBeenCalled();
    expect(target.upsertPoints).not.toHaveBeenCalled();
    const output = JSON.parse(write.mock.calls[0]?.[0] as string) as {
      targetCreated: string;
      verify: string;
      copy: { dryRun: boolean; upserted: number; resync: null };
    };
    expect(output.targetCreated).toBe('dry-run');
    expect(output.verify).toBe('dry-run');
    expect(output.copy).toMatchObject({ dryRun: true, upserted: 1, resync: null });
  });

  it('rejects an existing in-RAM leftover as the migration target', async () => {
    const source = fakeClient('events', 1);
    const target = fakeClient('events_ondisk', 1, { layout: 'inram' });
    await expect(
      runQdrantMigrateCollection(migrateArgs({ copy: true, writersPaused: true }), {
        env: LOCAL_ENV,
        createClient: (opts) => (opts.collection === 'events' ? source.client : target.client),
      }),
    ).rejects.toThrow(/on_disk/);
    expect(target.upsertPoints).not.toHaveBeenCalled();
  });

  it('measures source and target RAM/recall after a live copy', async () => {
    const source = fakeClient('events', 1);
    const targetCreate = fakeClient('events_ondisk', 0);
    const target = fakeClient('events_ondisk', 1);
    const clients = [source.client, targetCreate.client, target.client];
    const write = vi.fn();

    await runQdrantMigrateCollection(
      migrateArgs({
        createTarget: true,
        copy: true,
        measure: true,
        writersPaused: true,
        teamId: TEAM,
        userId: USER,
      }),
      {
        env: LOCAL_ENV,
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
    expect(target.collectionMemory).toHaveBeenCalled();
    expect(source.search).toHaveBeenCalled();
    expect(target.search).toHaveBeenCalled();
    const output = JSON.parse(write.mock.calls[0]?.[0] as string) as {
      ram: { source?: { metricBytes: { total_ram_bytes: number } }; target?: unknown };
      recall: { source?: { meanRecall: number }; target?: { meanRecall: number } };
    };
    expect(output.ram.source).toBeDefined();
    expect(output.ram.target).toBeDefined();
    expect(output.ram.source?.metricBytes.total_ram_bytes).toBe(100);
    expect(output.recall.source?.meanRecall).toBe(1);
    expect(output.recall.target?.meanRecall).toBe(1);
  });

  it('measures the target when --measure is used alone', async () => {
    const source = fakeClient('events', 1);
    const target = fakeClient('events_ondisk', 1);
    const write = vi.fn();

    await runQdrantMigrateCollection(migrateArgs({ measure: true, teamId: TEAM, userId: USER }), {
      env: LOCAL_ENV,
      createClient: (opts) => (opts.collection === 'events' ? source.client : target.client),
      write,
    });

    expect(target.collectionMemory).toHaveBeenCalled();
    expect(target.search).toHaveBeenCalled();
    const output = JSON.parse(write.mock.calls[0]?.[0] as string) as {
      ram: { target?: unknown };
      recall: { target?: { status: string } };
    };
    expect(output.ram.target).toBeDefined();
    expect(output.recall.target?.status).toBe('ok');
  });

  it('exits non-zero when recall has no comparable queries', async () => {
    const source = fakeClient('events', 0, { searchHits: [] });
    source.scrollPoints.mockResolvedValue({ points: [], nextOffset: null });
    const target = fakeClient('events_ondisk', 0, { searchHits: [] });
    target.scrollPoints.mockResolvedValue({ points: [], nextOffset: null });
    const setExitCode = vi.fn();
    const write = vi.fn();

    await runQdrantMigrateCollection(migrateArgs({ measure: true, teamId: TEAM, userId: USER }), {
      env: LOCAL_ENV,
      createClient: (opts) => (opts.collection === 'events' ? source.client : target.client),
      write,
      setExitCode,
    });

    const output = JSON.parse(write.mock.calls[0]?.[0] as string) as {
      recall: { source: { status: string; meanRecall: number | null } };
    };
    expect(output.recall.source).toMatchObject({ status: 'no_data', meanRecall: null });
    expect(setExitCode).toHaveBeenCalledWith(1);
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
