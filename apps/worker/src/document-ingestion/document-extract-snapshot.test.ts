import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DOCUMENT_EXTRACT_SNAPSHOT_IMAGE_REVISION,
  DOCUMENT_EXTRACT_SNAPSHOT_PREFIX,
  documentExtractSnapshotName,
  ensureDocumentExtractSnapshot,
  hashDocumentExtractSandbox,
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
      .mockRejectedValueOnce(new Error('not found'))
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
});
