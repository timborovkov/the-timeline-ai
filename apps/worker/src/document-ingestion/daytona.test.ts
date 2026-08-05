import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as SharedModule from '@timeline/shared';

import {
  daytonaSandboxCreateParams,
  downloadSandboxPageImages,
  extractPdfInDaytonaSandbox,
  parseSandboxJsonObject,
} from '#src/document-ingestion/daytona.js';

const fakes = vi.hoisted(() => ({
  create: vi.fn(),
  delete: vi.fn(),
  uploadFile: vi.fn(),
  downloadFile: vi.fn(),
  executeCommand: vi.fn(),
}));

vi.mock('@daytonaio/sdk', () => ({
  Daytona: class {
    create(...args: unknown[]): Promise<unknown> {
      return fakes.create(...args) as Promise<unknown>;
    }
  },
}));

vi.mock('@timeline/shared', async () => {
  const actual = await vi.importActual<typeof SharedModule>('@timeline/shared');
  return {
    ...actual,
    getEnv: () => ({
      DAYTONA_API_KEY: 'dtn_test',
      DAYTONA_API_URL: 'https://app.daytona.io/api',
      DAYTONA_TARGET: 'us',
      DAYTONA_SNAPSHOT: 'timeline-document-extract-testpin',
      DAYTONA_SNAPSHOT_ENSURE: true,
      DOCUMENT_EXTRACT_SPARSE_TEXT_CHARS: 500,
      DOCUMENT_EXTRACT_MAX_VISION_PAGES: 20,
    }),
    childLogger: () => ({
      warn: vi.fn(),
      info: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  };
});

describe('daytonaSandboxCreateParams', () => {
  it('creates sandboxes with networkBlockAll and no secrets surface', () => {
    const params = daytonaSandboxCreateParams('timeline-document-extract');
    expect(params).toMatchObject({
      snapshot: 'timeline-document-extract',
      language: 'python',
      networkBlockAll: true,
      ephemeral: true,
    });
    expect(params).not.toHaveProperty('envVars');
    expect(params).not.toHaveProperty('secrets');
  });
});

describe('parseSandboxJsonObject', () => {
  it('prefers the last JSON object line', () => {
    const parsed = parseSandboxJsonObject('warning: x\n{"ok":true,"text":"hi"}\n');
    expect(parsed).toEqual({ ok: true, text: 'hi' });
  });
});

describe('downloadSandboxPageImages', () => {
  it('throws when any page download fails (fail closed)', async () => {
    const sandbox = {
      fs: {
        downloadFile: vi
          .fn()
          .mockResolvedValueOnce(Buffer.from('png1'))
          .mockRejectedValueOnce(new Error('boom')),
      },
    };
    await expect(
      downloadSandboxPageImages(sandbox as never, ['/tmp/a.png', '/tmp/b.png']),
    ).rejects.toThrow(/failed to download sandbox page image/);
  });

  it('returns all images when downloads succeed', async () => {
    const sandbox = {
      fs: {
        downloadFile: vi
          .fn()
          .mockResolvedValueOnce(Buffer.from('png1'))
          .mockResolvedValueOnce(Buffer.from('png2')),
      },
    };
    const images = await downloadSandboxPageImages(sandbox as never, ['/tmp/a.png', '/tmp/b.png']);
    expect(images).toHaveLength(2);
  });
});

describe('extractPdfInDaytonaSandbox', () => {
  beforeEach(() => {
    fakes.create.mockReset();
    fakes.delete.mockReset();
    fakes.uploadFile.mockReset();
    fakes.downloadFile.mockReset();
    fakes.executeCommand.mockReset();

    const sandbox = {
      id: 'sbx_test',
      delete: fakes.delete.mockResolvedValue(undefined),
      fs: {
        uploadFile: fakes.uploadFile.mockResolvedValue(undefined),
        downloadFile: fakes.downloadFile,
      },
      process: {
        executeCommand: fakes.executeCommand,
      },
    };
    fakes.create.mockResolvedValue(sandbox);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('creates sandboxes with networkBlockAll and omits incomplete pageImages', async () => {
    fakes.executeCommand
      .mockResolvedValueOnce({ exitCode: 0, result: 'ok' }) // mkdir
      .mockResolvedValueOnce({
        exitCode: 0,
        result: JSON.stringify({
          ok: true,
          method: 'render',
          text: '',
          pageCount: 2,
          sparse: true,
          pageImagePaths: ['/tmp/timeline-extract/pages/page-0001.png', '/tmp/p2.png'],
          error: null,
        }),
      });
    fakes.downloadFile
      .mockResolvedValueOnce(Buffer.from('png1'))
      .mockRejectedValueOnce(new Error('transfer failed'));

    const result = await extractPdfInDaytonaSandbox(Buffer.from('%PDF'));

    expect(fakes.create).toHaveBeenCalledWith(
      expect.objectContaining({ networkBlockAll: true, ephemeral: true }),
      expect.anything(),
    );
    const createArg = fakes.create.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(createArg).not.toHaveProperty('envVars');
    expect(createArg).not.toHaveProperty('secrets');

    expect(result.sparse).toBe(true);
    expect(result.pageImages).toEqual([]);
    expect(fakes.delete).toHaveBeenCalled();
  });

  it('throws when the extract command exits non-zero without JSON', async () => {
    fakes.executeCommand
      .mockResolvedValueOnce({ exitCode: 0, result: 'ok' })
      .mockResolvedValueOnce({ exitCode: 2, result: 'python: fatal segfault' });

    await expect(extractPdfInDaytonaSandbox(Buffer.from('%PDF'))).rejects.toThrow(
      /exited 2 without usable JSON/,
    );
  });
});
