import { Daytona, type Sandbox } from '@daytonaio/sdk';
import { childLogger, getEnv } from '@timeline/shared';

import {
  maxVisionPages,
  type SandboxDocxExtractResult,
  type SandboxPdfExtractResult,
} from '#src/document-ingestion/types.js';

const log = childLogger('worker:document-ingestion:daytona');

const REMOTE_WORK = '/tmp/timeline-extract';
const REMOTE_PDF_SCRIPT = '/opt/timeline/extract_pdf.py';
const REMOTE_DOCX_SCRIPT = '/opt/timeline/extract_docx.py';

function createDaytonaClient(): Daytona {
  const env = getEnv();
  if (!env.DAYTONA_API_KEY) {
    throw new Error('DAYTONA_API_KEY is required for Daytona document extraction');
  }
  return new Daytona({
    apiKey: env.DAYTONA_API_KEY,
    apiUrl: env.DAYTONA_API_URL,
    target: env.DAYTONA_TARGET,
  });
}

async function withSandbox<T>(fn: (sandbox: Sandbox) => Promise<T>): Promise<T> {
  const env = getEnv();
  const daytona = createDaytonaClient();
  const sandbox = await daytona.create(
    {
      snapshot: env.DAYTONA_SNAPSHOT,
      language: 'python',
      networkBlockAll: true,
      ephemeral: true,
      autoStopInterval: 5,
      labels: { purpose: 'timeline-document-extract' },
    },
    { timeout: 120 },
  );
  try {
    return await fn(sandbox);
  } finally {
    try {
      await sandbox.delete(30);
    } catch (err: unknown) {
      log.warn(
        { err: err instanceof Error ? err.message : String(err), sandboxId: sandbox.id },
        'failed to delete Daytona sandbox',
      );
    }
  }
}

function parseJsonObject(stdout: string): Record<string, unknown> {
  const trimmed = stdout.trim();
  // Prefer the last JSON object line — Python may print warnings first.
  const lines = trimmed.split('\n').filter((line) => line.trim().startsWith('{'));
  const candidate = lines.at(-1) ?? trimmed;
  const parsed: unknown = JSON.parse(candidate);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('sandbox extract returned non-object JSON');
  }
  return parsed as Record<string, unknown>;
}

async function downloadPageImages(sandbox: Sandbox, paths: string[]): Promise<Buffer[]> {
  const images: Buffer[] = [];
  for (const remotePath of paths) {
    if (typeof remotePath !== 'string' || remotePath.length === 0) continue;
    try {
      const buf = await sandbox.fs.downloadFile(remotePath);
      if (buf.byteLength > 0) images.push(buf);
    } catch (err: unknown) {
      log.warn(
        { err: err instanceof Error ? err.message : String(err), remotePath },
        'failed to download sandbox page image',
      );
    }
  }
  return images;
}

/**
 * Upload PDF bytes into a fresh Daytona sandbox, run the baked Python
 * extractor, and return text + optional page PNGs for vision.
 */
export async function extractPdfInDaytonaSandbox(body: Buffer): Promise<SandboxPdfExtractResult> {
  const env = getEnv();
  const sparseChars = env.DOCUMENT_EXTRACT_SPARSE_TEXT_CHARS;
  const maxPages = maxVisionPages(env.DOCUMENT_EXTRACT_MAX_VISION_PAGES);

  return withSandbox(async (sandbox) => {
    await sandbox.process.executeCommand(`mkdir -p ${REMOTE_WORK}/pages`);
    const remotePdf = `${REMOTE_WORK}/input.pdf`;
    await sandbox.fs.uploadFile(body, remotePdf);

    const cmd = [
      'python3',
      REMOTE_PDF_SCRIPT,
      '--input',
      remotePdf,
      '--out-dir',
      REMOTE_WORK,
      '--sparse-chars',
      String(sparseChars),
      '--max-pages',
      String(maxPages),
    ].join(' ');
    const response = await sandbox.process.executeCommand(cmd, undefined, undefined, 90);
    const parsed = parseJsonObject(response.result ?? '');
    const text = typeof parsed.text === 'string' ? parsed.text : '';
    const method = typeof parsed.method === 'string' ? parsed.method : 'unknown';
    const pageCount = typeof parsed.pageCount === 'number' ? parsed.pageCount : 0;
    const sparse = parsed.sparse === true || text.trim().length < sparseChars;
    const pageImagePaths = Array.isArray(parsed.pageImagePaths)
      ? parsed.pageImagePaths.filter((p): p is string => typeof p === 'string')
      : [];
    const error = typeof parsed.error === 'string' ? parsed.error : undefined;
    const pageImages = sparse ? await downloadPageImages(sandbox, pageImagePaths) : [];

    if (!text.trim() && pageImages.length === 0) {
      throw new Error(error ?? 'sandbox PDF extract produced no text or page images');
    }

    return {
      text,
      method,
      pageCount,
      sparse,
      pageImages,
      ...(error ? { error } : {}),
    };
  });
}

/** Upload DOCX bytes into a Daytona sandbox and return plain text. */
export async function extractDocxInDaytonaSandbox(body: Buffer): Promise<SandboxDocxExtractResult> {
  return withSandbox(async (sandbox) => {
    await sandbox.process.executeCommand(`mkdir -p ${REMOTE_WORK}`);
    const remoteDocx = `${REMOTE_WORK}/input.docx`;
    await sandbox.fs.uploadFile(body, remoteDocx);
    const cmd = ['python3', REMOTE_DOCX_SCRIPT, '--input', remoteDocx].join(' ');
    const response = await sandbox.process.executeCommand(cmd, undefined, undefined, 60);
    const parsed = parseJsonObject(response.result ?? '');
    const text = typeof parsed.text === 'string' ? parsed.text : '';
    const error = typeof parsed.error === 'string' ? parsed.error : undefined;
    if (parsed.ok !== true && !text.trim()) {
      throw new Error(error ?? 'sandbox DOCX extract failed');
    }
    return { text, ...(error ? { error } : {}) };
  });
}

export function isDaytonaConfigured(): boolean {
  return Boolean(getEnv().DAYTONA_API_KEY);
}
