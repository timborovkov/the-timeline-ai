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
    teamIds: [],
    allTeams: false,
    production: false,
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
  patchOptimizers: ReturnType<typeof vi.fn>;
  countPoints: ReturnType<typeof vi.fn>;
  search: ReturnType<typeof vi.fn>;
  scrollPoints: ReturnType<typeof vi.fn>;
} {
  const layout = opts.layout ?? 'ondisk';
  const ensureCollection = vi.fn().mockResolvedValue(undefined);
  const upsertPoints = vi.fn().mockResolvedValue(undefined);
  const collectionInfo = vi.fn().mockResolvedValue({
    result: {
      points_count: points,
      indexed_vectors_count: points,
      optimizer_status: 'ok',
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
  const searchHits = opts.searchHits ?? [
    { id: 'p1', score: 1 },
    { id: 'p2', score: 0.9 },
  ];
  const patchOptimizers = vi.fn().mockResolvedValue(undefined);
  const countPoints = vi.fn().mockResolvedValue(points);
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
    createSnapshot: vi.fn().mockResolvedValue({ name: 'events-backup.snapshot', size: 1024 }),
    collectionName: () => name,
    ensureCollection,
    countAllPoints: vi.fn().mockResolvedValue(points),
    countPoints,
    patchOptimizers,
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
    patchOptimizers,
    countPoints,
    search,
    scrollPoints,
  };
}

describe('qdrant-migrate-collection CLI', () => {
  it('backs up production before creating or writing the target and refuses failed backups', async () => {
    const source = fakeClient('events');
    const target = fakeClient('events_ondisk');
    const env = {
      NODE_ENV: 'production',
      QDRANT_URL: 'https://qdrant.example.com',
      ALLOW_QDRANT_MIGRATE_PRODUCTION: 'I_UNDERSTAND_THIS_MIGRATES_PRODUCTION_QDRANT',
    };
    const args = parseArgs([
      '--source-collection=events',
      '--target-collection=events_ondisk',
      '--production',
      '--create-target',
      '--copy',
      '--verify',
      '--writers-paused',
      '--all-teams',
    ]);
    const snapshot = vi.spyOn(source.client, 'createSnapshot');
    snapshot.mockRejectedValueOnce(new Error('snapshot storage unavailable'));
    const createClient = (opts: { collection?: string }) =>
      opts.collection === 'events' ? source.client : target.client;
    await expect(
      runQdrantMigrateCollection(args, { env, createClient, write: vi.fn() }),
    ).rejects.toThrow('snapshot storage unavailable');
    expect(target.ensureCollection).not.toHaveBeenCalled();
    expect(target.upsertPoints).not.toHaveBeenCalled();
    const write = vi.fn();
    await runQdrantMigrateCollection(args, { env, createClient, write });
    expect(snapshot).toHaveBeenCalledTimes(2);
    expect(target.upsertPoints).toHaveBeenCalled();
    expect(JSON.parse(write.mock.calls.at(-1)?.[0] as string)).toMatchObject({
      snapshot: { name: 'events-backup.snapshot', size: 1024 },
      verify: { matched: true },
    });
    const setExitCode = vi.fn();
    vi.spyOn(source.client, 'countAllPoints').mockResolvedValueOnce(3);
    await runQdrantMigrateCollection(args, { env, createClient, write, setExitCode });
    expect(setExitCode).toHaveBeenCalledWith(1);
    expect(JSON.parse(write.mock.calls.at(-1)?.[0] as string)).toMatchObject({
      verify: { matched: false, totalCounts: { source: 3, target: 2 } },
    });
    snapshot.mockClear();
    await runQdrantMigrateCollection({ ...args, dryRun: true }, { env, createClient, write });
    expect(snapshot).not.toHaveBeenCalled();
    await expect(
      runQdrantMigrateCollection(
        { ...args, sourceCollection: 'wrong_source' },
        { env, createClient, write },
      ),
    ).rejects.toThrow(/active QDRANT_COLLECTION/);
    expect(snapshot).not.toHaveBeenCalled();
  });

  it('parses the copy/verify flow used by the documented cutover', () => {
    expect(
      parseArgs([
        '--source-collection=events',
        '--target-collection=events_ondisk',
        '--create-target',
        '--copy',
        '--verify',
        '--writers-paused',
        '--all-teams',
      ]),
    ).toMatchObject({
      sourceCollection: 'events',
      targetCollection: 'events_ondisk',
      createTarget: true,
      copy: true,
      verify: true,
      writersPaused: true,
      allTeams: true,
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
      parseArgs([
        '--source-collection=events',
        '--target-collection=events_ondisk',
        '--copy',
        '--writers-paused',
      ]),
    ).toThrow(/--all-teams/);
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
      migrateArgs({
        createTarget: true,
        copy: true,
        verify: true,
        writersPaused: true,
        teamIds: [TEAM],
      }),
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
      migrateArgs({
        createTarget: true,
        copy: true,
        verify: true,
        dryRun: true,
        teamIds: [TEAM],
      }),
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

  it('dry-run --measure does not patch optimizers or require a created target', async () => {
    const source = fakeClient('events', 1);
    const target = fakeClient('events_ondisk', 0);
    const write = vi.fn();

    await runQdrantMigrateCollection(
      migrateArgs({
        createTarget: true,
        measure: true,
        dryRun: true,
        teamId: TEAM,
        userId: USER,
      }),
      {
        env: LOCAL_ENV,
        createClient: (opts) => (opts.collection === 'events' ? source.client : target.client),
        write,
      },
    );

    expect(source.patchOptimizers).not.toHaveBeenCalled();
    expect(target.patchOptimizers).not.toHaveBeenCalled();
    expect(target.ensureCollection).not.toHaveBeenCalled();
    expect(target.collectionMemory).not.toHaveBeenCalled();
    expect(source.search).not.toHaveBeenCalled();
    const output = JSON.parse(write.mock.calls[0]?.[0] as string) as {
      ram: string;
      recall: string;
      targetCreated: string;
    };
    expect(output.targetCreated).toBe('dry-run');
    expect(output.ram).toBe('dry-run');
    expect(output.recall).toBe('dry-run');
  });

  it('rejects an existing in-RAM leftover as the migration target', async () => {
    const source = fakeClient('events', 1);
    const target = fakeClient('events_ondisk', 1, { layout: 'inram' });
    await expect(
      runQdrantMigrateCollection(
        migrateArgs({ copy: true, writersPaused: true, teamIds: [TEAM] }),
        {
          env: LOCAL_ENV,
          createClient: (opts) => (opts.collection === 'events' ? source.client : target.client),
        },
      ),
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
        teamIds: [TEAM],
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

    expect(source.patchOptimizers).toHaveBeenCalled();
    expect(target.patchOptimizers).toHaveBeenCalled();
    expect(source.patchOptimizers.mock.invocationCallOrder[0]).toBeLessThan(
      source.collectionMemory.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
    expect(target.patchOptimizers.mock.invocationCallOrder[0]).toBeLessThan(
      target.collectionMemory.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
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

  it('verifies the union of source and target teams on --all-teams', async () => {
    const teamB = '20000000-0000-4000-8000-000000000002';
    const source = fakeClient('events', 1);
    const target = fakeClient('events_ondisk', 1);
    source.scrollPoints.mockImplementation((input?: { unfiltered?: boolean }) => {
      if (input?.unfiltered) {
        return {
          points: [{ id: 's1', payload: { team_id: TEAM } }],
          nextOffset: null,
        };
      }
      return {
        points: [
          {
            id: 's1',
            vector: [0.1, 0.2, 0.3, 0.4],
            payload: {
              team_id: TEAM,
              visibility: 'team',
              source_kind: 'raw_event',
              source_id: 's1',
            },
          },
        ],
        nextOffset: null,
      };
    });
    target.scrollPoints.mockImplementation((input?: { unfiltered?: boolean }) => {
      if (input?.unfiltered) {
        return {
          points: [
            { id: 's1', payload: { team_id: TEAM } },
            { id: 't-extra', payload: { team_id: teamB } },
          ],
          nextOffset: null,
        };
      }
      return {
        points: [
          {
            id: 't-extra',
            vector: [0.5, 0.6, 0.7, 0.8],
            payload: {
              team_id: teamB,
              visibility: 'team',
              source_kind: 'raw_event',
              source_id: 't-extra',
            },
          },
        ],
        nextOffset: null,
      };
    });
    const write = vi.fn();
    const setExitCode = vi.fn();

    await runQdrantMigrateCollection(migrateArgs({ verify: true, allTeams: true }), {
      env: LOCAL_ENV,
      createClient: (opts) => (opts.collection === 'events' ? source.client : target.client),
      write,
      setExitCode,
    });

    expect(source.scrollPoints).toHaveBeenCalledWith(
      expect.objectContaining({ unfiltered: true, withPayload: ['team_id'] }),
    );
    expect(target.scrollPoints).toHaveBeenCalledWith(
      expect.objectContaining({ unfiltered: true, withPayload: ['team_id'] }),
    );
    expect(source.countPoints).toHaveBeenCalledWith(TEAM);
    expect(source.countPoints).toHaveBeenCalledWith(teamB);
    expect(target.countPoints).toHaveBeenCalledWith(teamB);
    const output = JSON.parse(write.mock.calls[0]?.[0] as string) as {
      verifyTeamIds: string[];
      verify: { matched: boolean; extraInTarget?: string[] };
    };
    expect(output.verifyTeamIds).toEqual([TEAM, teamB]);
    expect(output.verify.matched).toBe(false);
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
