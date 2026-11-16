import { PGlite } from '@electric-sql/pglite';
import { type Db } from '@timeline/db';
import { PlatformAccessError } from '@timeline/shared/platform-admin';
import { expect, vi } from '@timeline/test-support';
import { type Job } from 'bullmq';
import { afterAll, beforeAll, describe, it } from 'bun:test';
import { drizzle } from 'drizzle-orm/pglite';

import { guardWorkerProcessor } from '#src/platform-worker.js';
import { applyDbMigrations } from '#src/test/pglite.js';

// Queued work for an inactive workspace completes without effects or retries;
// unrelated authorization and infrastructure failures must remain visible.
const teamId = '11111111-1111-1111-1111-111111111111';
let pg: PGlite;
let db: Db;
beforeAll(async () => {
  pg = new PGlite();
  await applyDbMigrations(pg);
  db = drizzle(pg) as unknown as Db;
  await pg.exec(
    `INSERT INTO teams (id,slug,name,disabled_at) VALUES ('${teamId}','inactive','Inactive',now())`,
  );
});
afterAll(async () => {
  await pg.close();
});

describe('workspace job admission', () => {
  it('skips disabled workspace jobs before attribution recovery or processing', async () => {
    const callback = vi.fn(() => Promise.resolve('processed'));
    const processor = guardWorkerProcessor(db, callback);
    const result = await processor({ data: { teamId, documentVersionId: 'not-a-uuid' } } as Job<
      unknown,
      string
    >);
    expect(result).toEqual({ skipped: true, reason: 'workspace_inactive' });
    expect(callback).not.toHaveBeenCalled();
  });

  it('continues active work and skips only the exact lifecycle trigger error', async () => {
    await pg.exec(`UPDATE teams SET disabled_at = null WHERE id = '${teamId}'`);
    const job = { data: { teamId } } as Job<unknown, string>;
    expect(await guardWorkerProcessor(db, () => Promise.resolve('processed'))(job)).toBe(
      'processed',
    );
    const trigger = Object.assign(new Error('Workspace is disabled'), { code: '42501' });
    expect(
      await guardWorkerProcessor<unknown, string, string>(db, () =>
        Promise.reject(new Error('Failed query', { cause: trigger })),
      )(job),
    ).toEqual({ skipped: true, reason: 'workspace_inactive' });
    for (const error of [
      new PlatformAccessError('Impersonation expired'),
      Object.assign(new Error('permission denied'), { code: '42501' }),
      new Error('connection lost'),
    ]) {
      await expect(
        guardWorkerProcessor<unknown, string, string>(db, () => Promise.reject(error))(job),
      ).rejects.toThrow(error.message);
    }
  });
});

it('does not silently complete a global tick when one workspace rejects work', async () => {
  const { InactiveWorkspaceError } = await import('@timeline/shared/platform-admin/runtime');
  const processor = guardWorkerProcessor<unknown, string, string>(db, () =>
    Promise.reject(new InactiveWorkspaceError('Workspace disabled during tick')),
  );
  await expect(processor({ data: { kind: 'tick' } } as Job<unknown, string>)).rejects.toThrow(
    'Workspace disabled during tick',
  );
});
