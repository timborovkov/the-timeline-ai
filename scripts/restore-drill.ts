import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';

import {
  CreateBucketCommand,
  GetObjectCommand,
  ListObjectVersionsCommand,
  PutBucketVersioningCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { createQdrantClient } from '@timeline/shared/qdrant';

const prefix = `timeline-restore-${randomUUID().slice(0, 8)}`;
const containers = new Set<string>();
const postgresPassword = randomUUID();
const accessKey = 'restore-drill';
const secretKey = randomUUID();
const team = randomUUID();
const otherTeam = randomUUID();
const user = randomUUID();
const event = randomUUID();
const doc = randomUUID();
const version = randomUUID();
const laterEvent = randomUUID();
const audioKey = `${team}/restore-drill.wav`;
const documentKey = `${team}/${doc}/${version}/restore-drill.txt`;
const collection = 'restore_drill';
const vector = [1, 0, 0, 0];
const buckets = [
  'timeline-audio',
  'timeline-attachments',
  'timeline-documents',
  'timeline-exports',
];

function docker(args: string[], input?: string | Uint8Array): Buffer {
  return execFileSync('docker', args, { input, maxBuffer: 32 * 1024 * 1024 });
}

function port(name: string, inside: number): number {
  const address = docker(['port', name, `${inside}/tcp`])
    .toString()
    .trim();
  const match = /^127\.0\.0\.1:(\d+)$/.exec(address);
  if (!match?.[1]) throw new Error('Docker did not assign a loopback port');
  return Number(match[1]);
}

async function untilReady(check: () => boolean | Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 90_000;
  do {
    if (
      await Promise.resolve()
        .then(check)
        .catch(() => false)
    )
      return;
    await Bun.sleep(500);
  } while (Date.now() < deadline);
  throw new Error('Isolated store did not become ready');
}

type Images = Record<'postgres' | 'rustfs' | 'qdrant', { image: string }>;

function startContainer(name: string, image: string, port: number, env: Record<string, string>) {
  docker([
    'run',
    '--detach',
    '--rm',
    '--name',
    name,
    '--publish',
    `127.0.0.1::${port}`,
    ...Object.entries(env).flatMap(([key, value]) => ['--env', `${key}=${value}`]),
    image,
  ]);
  containers.add(name);
}

interface Stores {
  postgres: string;
  databaseUrl: string;
  s3: S3Client;
  qdrant: string;
}

function migrate(url: string) {
  const result = Bun.spawnSync(
    [process.execPath, '--no-env-file', '--conditions=development', 'packages/db/src/migrate.ts'],
    { env: { PATH: process.env.PATH, DATABASE_URL: url }, stdout: 'inherit', stderr: 'inherit' },
  );
  assert.equal(result.exitCode, 0, 'Migrate isolated database');
}

async function startStores(label: string, images: Images): Promise<Stores> {
  const postgres = `${prefix}-${label}-pg`;
  const rustfs = `${prefix}-${label}-s3`;
  const qdrantName = `${prefix}-${label}-vector`;
  startContainer(postgres, images.postgres.image, 5432, {
    POSTGRES_USER: 'timeline',
    POSTGRES_DB: 'timeline',
    POSTGRES_PASSWORD: postgresPassword,
  });
  startContainer(rustfs, images.rustfs.image, 9000, {
    RUSTFS_ACCESS_KEY: accessKey,
    RUSTFS_SECRET_KEY: secretKey,
    RUSTFS_VOLUMES: '/data',
  });
  startContainer(qdrantName, images.qdrant.image, 6333, {
    QDRANT__STORAGE__SNAPSHOTS_PATH: '/qdrant/storage/snapshots',
  });
  const s3 = `http://127.0.0.1:${port(rustfs, 9000)}`;
  const qdrant = `http://127.0.0.1:${port(qdrantName, 6333)}`;
  await Promise.all([
    untilReady(() =>
      Boolean(docker(['exec', postgres, 'pg_isready', '-q', '-h', '127.0.0.1', '-U', 'timeline'])),
    ),
    untilReady(async () => (await fetch(`${s3}/health`)).ok),
    untilReady(async () => (await fetch(`${qdrant}/readyz`)).ok),
  ]);
  return {
    postgres,
    qdrant,
    databaseUrl: `postgres://timeline:${postgresPassword}@127.0.0.1:${port(postgres, 5432)}/timeline`,
    s3: new S3Client({
      endpoint: s3,
      forcePathStyle: true,
      region: 'us-east-1',
      credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    }),
  };
}

function psql(store: Stores, statement: string) {
  return docker(
    ['exec', '-i', store.postgres, 'psql', '-XAt', '-v', 'ON_ERROR_STOP=1', '-U', 'timeline'],
    statement,
  )
    .toString()
    .trim();
}

async function qdrantRequest(base: string, path: string, init?: RequestInit) {
  const response = await fetch(base + path, { ...init, signal: AbortSignal.timeout(20_000) });
  assert.ok(response.ok, `Qdrant ${init?.method ?? 'GET'} ${path} returned ${response.status}`);
  return response;
}

function payload(teamId: string, eventId: string) {
  return {
    team_id: teamId,
    event_id: eventId,
    author_user_id: user,
    visibility: 'team',
    source_kind: 'raw_event',
    source: 'web',
    occurred_at: new Date().toISOString(),
  };
}

async function initBuckets(client: S3Client) {
  for (const bucket of buckets) {
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
    await client.send(
      new PutBucketVersioningCommand({
        Bucket: bucket,
        VersioningConfiguration: { Status: 'Enabled' },
      }),
    );
  }
}

const fixtureObjects = [
  { bucket: 'timeline-audio', key: audioKey, body: 'synthetic audio bytes' },
  { bucket: 'timeline-attachments', key: `${team}/example.txt`, body: 'synthetic attachment' },
  { bucket: 'timeline-documents', key: documentKey, body: 'synthetic document' },
  { bucket: 'timeline-exports', key: `${team}/example.zip`, body: 'synthetic export bytes' },
];

function checksum(body: Uint8Array | string) {
  return createHash('sha256').update(body).digest('hex');
}

async function readObject(client: S3Client, bucket: string, key: string, versionId?: string) {
  const { Body } = await client.send(
    new GetObjectCommand({ Bucket: bucket, Key: key, VersionId: versionId }),
  );
  assert.ok(Body, 'Object body exists');
  return Body.transformToByteArray();
}

async function seed(source: Stores) {
  migrate(source.databaseUrl);
  await initBuckets(source.s3);
  for (const { bucket, key, body } of fixtureObjects) {
    await source.s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body }));
  }
  // An older logical version proves the restored bucket retains version history,
  // including distinct bytes under the same key.
  await source.s3.send(
    new PutObjectCommand({
      Bucket: 'timeline-attachments',
      Key: fixtureObjects[1]?.key,
      Body: 'new attachment version',
    }),
  );
  psql(
    source,
    `
    INSERT INTO users (id, email) VALUES ('${user}', 'restore@example.test');
    INSERT INTO teams (id, slug, name) VALUES ('${team}', 'restore', 'Restore drill'), ('${otherTeam}', 'other', 'Other team');
    INSERT INTO team_members (team_id, user_id, role) VALUES ('${team}', '${user}', 'owner');
    INSERT INTO raw_events (id, team_id, author_user_id, source, content_text, content_audio_url)
      VALUES ('${event}', '${team}', '${user}', 'web', 'Synthetic capture', '${audioKey}');
    INSERT INTO documents (id, team_id, name, source_raw_event_id)
      VALUES ('${doc}', '${team}', 'Synthetic document', '${event}');
    INSERT INTO document_versions (id, team_id, document_id, version, object_key, byte_size, checksum_sha256, source_event_id, processing_status)
      VALUES ('${version}', '${team}', '${doc}', 1, '${documentKey}', 18,
        '${checksum('synthetic document')}', '${event}', 'embedded');
    UPDATE documents SET current_version_id = '${version}' WHERE id = '${doc}';
  `,
  );
  await qdrantRequest(source.qdrant, `/collections/${collection}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ vectors: { size: vector.length, distance: 'Cosine' } }),
  });
  await qdrantRequest(source.qdrant, `/collections/${collection}/points?wait=true`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      points: [
        { id: randomUUID(), vector, payload: payload(team, event) },
        { id: randomUUID(), vector, payload: payload(otherTeam, randomUUID()) },
      ],
    }),
  });
}

async function backup(source: Stores) {
  const checkpoint = Date.now();
  const dump = docker([
    'exec',
    source.postgres,
    'pg_dump',
    '-Fc',
    '--no-owner',
    '--no-acl',
    '-U',
    'timeline',
    'timeline',
  ]);
  const objects = await Promise.all(
    fixtureObjects.map(async ({ bucket, key }) => {
      const list = await source.s3.send(
        new ListObjectVersionsCommand({ Bucket: bucket, Prefix: key }),
      );
      assert.equal(list.IsTruncated, false);
      const versions = (list.Versions ?? []).filter((entry) => entry.Key === key);
      assert.ok(versions.length > 0);
      assert.ok(versions[0]?.IsLatest);
      return {
        bucket,
        key,
        versions: await Promise.all(
          versions.reverse().map(async (entry) => {
            assert.ok(entry.VersionId && entry.VersionId !== 'null', 'Versioning is enabled');
            return readObject(source.s3, bucket, key, entry.VersionId);
          }),
        ),
      };
    }),
  );
  const path = `/collections/${collection}/snapshots`;
  const response = await qdrantRequest(source.qdrant, `${path}?wait=true`, { method: 'POST' });
  const { result } = (await response.json()) as { result: { name: string; size: number } };
  assert.ok(result.size > 0, 'Snapshot contains data');
  const snapshot = await (
    await qdrantRequest(source.qdrant, `${path}/${encodeURIComponent(result.name)}`)
  ).blob();
  return { checkpoint, dump, objects, snapshot };
}

async function restore(target: Stores, saved: Awaited<ReturnType<typeof backup>>) {
  docker(
    [
      'exec',
      '-i',
      target.postgres,
      'pg_restore',
      '--exit-on-error',
      '--no-owner',
      '--no-acl',
      '-U',
      'timeline',
      '-d',
      'timeline',
    ],
    saved.dump,
  );
  await initBuckets(target.s3);
  for (const { bucket, key, versions } of saved.objects) {
    for (const body of versions) {
      await target.s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body }));
    }
    const restored = await target.s3.send(
      new ListObjectVersionsCommand({ Bucket: bucket, Prefix: key }),
    );
    const actual = (restored.Versions ?? []).filter((item) => item.Key === key).reverse();
    assert.equal(actual.length, versions.length);
    for (const [index, item] of actual.entries()) {
      assert.ok(item.VersionId && item.VersionId !== 'null');
      assert.equal(
        checksum(await readObject(target.s3, bucket, key, item.VersionId)),
        checksum(versions[index]!),
      );
    }
  }
  const form = new FormData();
  form.set('snapshot', saved.snapshot, 'restore.snapshot');
  await qdrantRequest(
    target.qdrant,
    `/collections/${collection}/snapshots/upload?priority=snapshot&wait=true`,
    {
      method: 'POST',
      body: form,
    },
  );
}

async function verify(target: Stores) {
  const restored = psql(
    target,
    `
    SELECT e.content_audio_url, v.object_key, v.checksum_sha256
    FROM raw_events e
    JOIN document_versions v ON v.source_event_id=e.id AND v.team_id=e.team_id
    JOIN documents d ON d.current_version_id=v.id AND d.team_id=e.team_id
    JOIN team_members m ON m.team_id=e.team_id AND m.user_id=e.author_user_id
    WHERE e.id='${event}' AND d.id='${doc}' AND m.user_id='${user}';
  `,
  );
  assert.equal(restored, [audioKey, documentKey, checksum('synthetic document')].join('|'));
  assert.equal(
    checksum(await readObject(target.s3, 'timeline-documents', documentKey)),
    checksum('synthetic document'),
  );
  assert.equal(psql(target, `SELECT count(*) FROM raw_events WHERE id='${laterEvent}'`), '0');
  // The app's filtered search wrapper is used against the restored collection.
  process.env.DATABASE_URL = target.databaseUrl;
  process.env.QDRANT_URL = target.qdrant;
  process.env.AUTH_SECRET = randomUUID();
  delete process.env.QDRANT_API_KEY;
  const qdrant = createQdrantClient({
    collection,
    vectorSize: vector.length,
    requireExisting: true,
    repairTenantIndex: false,
  });
  const hits = await qdrant.search(team, user, vector);
  assert.deepEqual(
    hits.map((item) => item.payload.event_id),
    [event],
  );
}

try {
  const raw = docker([
    'compose',
    '--env-file',
    '/dev/null',
    'config',
    '--format',
    'json',
    'postgres',
    'qdrant',
    'rustfs',
  ]);
  const { services } = JSON.parse(raw.toString()) as { services: Images };
  const source = await startStores('source', services);
  await seed(source);
  const saved = await backup(source);

  const discardedAt = Date.now();
  psql(
    source,
    `
    INSERT INTO raw_events (id, team_id, source, content_text)
    VALUES ('${laterEvent}', '${team}', 'web', 'Write after the recovery point');
  `,
  );
  assert.equal(psql(source, `SELECT count(*) FROM raw_events WHERE id='${laterEvent}'`), '1');
  const incidentAt = Date.now();
  const target = await startStores('target', services);
  await restore(target, saved);
  await verify(target);

  const recoveryMs = Date.now() - incidentAt;
  const recoveryPointAgeMs = incidentAt - saved.checkpoint;
  assert.ok(discardedAt >= saved.checkpoint);
  assert.ok(recoveryMs <= 4 * 60 * 60_000);
  assert.ok(recoveryPointAgeMs <= 24 * 60 * 60_000);
  console.log(
    JSON.stringify(
      {
        recoveryMs,
        recoveryPointAgeMs,
        postBackupWritesMissing: 1,
        restoredObjectKeys: saved.objects.length,
        restoredObjectVersions: saved.objects.reduce(
          (count, item) => count + item.versions.length,
          0,
        ),
        restoredTeamSearch: true,
        images: {
          postgres: services.postgres.image,
          rustfs: services.rustfs.image,
          qdrant: services.qdrant.image,
        },
      },
      null,
      2,
    ),
  );
} finally {
  for (const name of containers) {
    try {
      docker(['rm', '--force', '--volumes', name]);
    } catch {
      console.error(`Failed to remove disposable container ${name}`);
      process.exitCode = 1;
    }
  }
}
