import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DaytonaNotFoundError } from '@daytonaio/sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DOCUMENT_EXTRACT_SNAPSHOT_IMAGE_REVISION,
  DOCUMENT_EXTRACT_SNAPSHOT_PREFIX,
  documentExtractSnapshotName,
  ensureDocumentExtractSnapshot,
  hashDocumentExtractSandbox,
  pruneDocumentExtractSnapshots,
  resolveDocumentExtractSnapshotName,
} from '#src/document-ingestion/document-extract-snapshot.js';

async function writeSandbox(dir: string, files: Record<string, string>): Promise<void> {
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(dir, rel);
    await mkdir(join(abs, '..'), { recursive: true });
    await writeFile(abs, body);
  }
}

describe('document-extract snapshot naming', () => {
  it('hashes sandbox inputs stably and ignores markdown', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'doc-extract-snap-'));
    await writeSandbox(dir, {
      'requirements.txt': 'firecrawl-anydoc==0.1.6\n',
      'extract_anydoc.py': 'print("anydoc")\n',
      'README.md': 'docs only\n',
    });

    const first = await hashDocumentExtractSandbox(dir);
    const second = await hashDocumentExtractSandbox(dir);
    expect(first).toMatch(/^[a-f0-9]{12}$/);
    expect(second).toBe(first);

    await writeFile(join(dir, 'README.md'), 'docs changed\n');
    expect(await hashDocumentExtractSandbox(dir)).toBe(first);

    await writeFile(join(dir, 'requirements.txt'), 'firecrawl-anydoc==0.1.7\n');
    expect(await hashDocumentExtractSandbox(dir)).not.toBe(first);
  });

  it('pins snapshot names to the content hash prefix', () => {
    expect(documentExtractSnapshotName('abcdef012345')).toBe(
      `${DOCUMENT_EXTRACT_SNAPSHOT_PREFIX}-abcdef012345`,
    );
    expect(DOCUMENT_EXTRACT_SNAPSHOT_IMAGE_REVISION.length).toBeGreaterThan(0);
  });

  it('resolves explicit pins and auto/content-hash to hashed names', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'doc-extract-snap-'));
    await writeSandbox(dir, {
      'requirements.txt': 'x\n',
      'extract_anydoc.py': 'x\n',
    });
    const hash = await hashDocumentExtractSandbox(dir);
    const expected = documentExtractSnapshotName(hash);

    expect(await resolveDocumentExtractSnapshotName('my-pin', dir)).toBe('my-pin');
    expect(await resolveDocumentExtractSnapshotName(undefined, dir)).toBe(expected);
    expect(await resolveDocumentExtractSnapshotName('auto', dir)).toBe(expected);
    expect(await resolveDocumentExtractSnapshotName('content-hash', dir)).toBe(expected);
  });
});

describe('ensureDocumentExtractSnapshot', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns created=false when the snapshot already exists', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'doc-extract-snap-'));
    await writeSandbox(dir, {
      'requirements.txt': 'x\n',
      'extract_anydoc.py': 'x\n',
    });
    const get = vi.fn().mockResolvedValue({ name: 'exists' });
    const create = vi.fn();
    const deleteFn = vi.fn();
    const daytona = {
      snapshot: { get, create, delete: deleteFn },
    };

    const result = await ensureDocumentExtractSnapshot({
      sandboxDir: dir,
      daytona: daytona as never,
    });

    expect(result.created).toBe(false);
    expect(result.name).toBe(documentExtractSnapshotName(result.contentHash));
    expect(create).not.toHaveBeenCalled();
    expect(deleteFn).not.toHaveBeenCalled();
  });

  it('creates when missing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'doc-extract-snap-'));
    await writeSandbox(dir, {
      'requirements.txt': 'x\n',
      'extract_anydoc.py': 'x\n',
    });
    const get = vi
      .fn()
      .mockRejectedValueOnce(new DaytonaNotFoundError('not found', 404))
      .mockResolvedValue({ name: 'new' });
    const create = vi.fn().mockResolvedValue({ name: 'new' });
    const daytona = {
      snapshot: { get, create, delete: vi.fn() },
    };

    const result = await ensureDocumentExtractSnapshot({
      sandboxDir: dir,
      daytona: daytona as never,
    });

    expect(result.created).toBe(true);
    expect(create).toHaveBeenCalledOnce();
    expect(create.mock.calls[0]?.[0]).toMatchObject({
      name: result.name,
      resources: { cpu: 1, memory: 2, disk: 3 },
    });
  });

  it('propagates snapshot lookup failures instead of treating them as missing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'doc-extract-snap-'));
    await writeSandbox(dir, {
      'requirements.txt': 'x\n',
      'extract_anydoc.py': 'x\n',
    });
    const create = vi.fn();
    const daytona = {
      snapshot: {
        get: vi.fn().mockRejectedValue(new Error('Daytona unavailable')),
        create,
        delete: vi.fn(),
      },
    };

    await expect(
      ensureDocumentExtractSnapshot({ sandboxDir: dir, daytona: daytona as never }),
    ).rejects.toThrow('Daytona unavailable');
    expect(create).not.toHaveBeenCalled();
  });

  it('propagates force-delete failures and does not report a rebuild', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'doc-extract-snap-'));
    await writeSandbox(dir, {
      'requirements.txt': 'x\n',
      'extract_anydoc.py': 'x\n',
    });
    const create = vi.fn();
    const daytona = {
      snapshot: {
        get: vi.fn().mockResolvedValue({ name: 'exists' }),
        create,
        delete: vi.fn().mockRejectedValue(new Error('delete failed')),
      },
    };

    await expect(
      ensureDocumentExtractSnapshot({ force: true, sandboxDir: dir, daytona: daytona as never }),
    ).rejects.toThrow('delete failed');
    expect(create).not.toHaveBeenCalled();
  });

  it('force-rebuilds after the deleted snapshot returns not found', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'doc-extract-snap-'));
    await writeSandbox(dir, {
      'requirements.txt': 'x\n',
      'extract_anydoc.py': 'x\n',
    });
    const create = vi.fn().mockResolvedValue({ name: 'new' });
    const get = vi
      .fn()
      .mockResolvedValueOnce({ name: 'exists' })
      .mockRejectedValueOnce(new DaytonaNotFoundError('not found', 404));
    const daytona = {
      snapshot: { get, create, delete: vi.fn().mockResolvedValue(undefined) },
    };

    const result = await ensureDocumentExtractSnapshot({
      force: true,
      sandboxDir: dir,
      daytona: daytona as never,
    });

    expect(result.created).toBe(true);
    expect(create).toHaveBeenCalledOnce();
  });
});

describe('pruneDocumentExtractSnapshots', () => {
  it('keeps the current and two newest hashed snapshots, deleting only unused older hashes', async () => {
    const currentName = `${DOCUMENT_EXTRACT_SNAPSHOT_PREFIX}-aaaaaaaaaaaa`;
    const snapshots = [
      { name: `${DOCUMENT_EXTRACT_SNAPSHOT_PREFIX}-bbbbbbbbbbbb`, createdAt: '2026-08-04' },
      { name: `${DOCUMENT_EXTRACT_SNAPSHOT_PREFIX}-cccccccccccc`, createdAt: '2026-08-03' },
      { name: currentName, createdAt: '2026-08-02' },
      { name: `${DOCUMENT_EXTRACT_SNAPSHOT_PREFIX}-dddddddddddd`, createdAt: '2026-08-01' },
      { name: `${DOCUMENT_EXTRACT_SNAPSHOT_PREFIX}-eeeeeeeeeeee`, createdAt: '2026-07-31' },
      { name: DOCUMENT_EXTRACT_SNAPSHOT_PREFIX, createdAt: '2026-07-30' },
      { name: 'auditai-sandbox-v4', createdAt: '2026-07-29' },
    ];
    const deleteFn = vi.fn();
    const listSandboxes = vi.fn().mockImplementation(async function* (query: {
      snapshots: string[];
    }) {
      await Promise.resolve();
      if (query.snapshots[0]?.endsWith('eeeeeeeeeeee')) yield { id: 'sandbox-in-use' };
    });
    const daytona = {
      snapshot: {
        list: vi.fn().mockResolvedValue({ items: snapshots, page: 1, totalPages: 1 }),
        delete: deleteFn,
      },
      list: listSandboxes,
    };

    const result = await pruneDocumentExtractSnapshots({
      currentName,
      retain: 3,
      daytona: daytona as never,
    });

    expect(result).toEqual({
      currentName,
      kept: [
        `${DOCUMENT_EXTRACT_SNAPSHOT_PREFIX}-bbbbbbbbbbbb`,
        `${DOCUMENT_EXTRACT_SNAPSHOT_PREFIX}-cccccccccccc`,
        currentName,
      ],
      deleted: [`${DOCUMENT_EXTRACT_SNAPSHOT_PREFIX}-dddddddddddd`],
      skippedInUse: [`${DOCUMENT_EXTRACT_SNAPSHOT_PREFIX}-eeeeeeeeeeee`],
    });
    expect(deleteFn).toHaveBeenCalledOnce();
    expect(deleteFn).toHaveBeenCalledWith(snapshots[3]);
    expect(listSandboxes).toHaveBeenCalledTimes(2);
  });

  it('fails closed when the current snapshot is absent', async () => {
    const deleteFn = vi.fn();
    const daytona = {
      snapshot: {
        list: vi.fn().mockResolvedValue({
          items: [
            {
              name: `${DOCUMENT_EXTRACT_SNAPSHOT_PREFIX}-bbbbbbbbbbbb`,
              createdAt: '2026-08-04',
            },
          ],
          page: 1,
          totalPages: 1,
        }),
        delete: deleteFn,
      },
      list: vi.fn(),
    };

    await expect(
      pruneDocumentExtractSnapshots({
        currentName: `${DOCUMENT_EXTRACT_SNAPSHOT_PREFIX}-aaaaaaaaaaaa`,
        retain: 3,
        daytona: daytona as never,
      }),
    ).rejects.toThrow('current snapshot was not returned by Daytona');
    expect(deleteFn).not.toHaveBeenCalled();
  });
});
