import { Daytona, type Sandbox } from '@daytonaio/sdk';
import { childLogger, getEnv } from '@timeline/shared';

import { resolveDocumentExtractSnapshotName } from '#src/document-ingestion/document-extract-snapshot.js';
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

/** Exported for unit tests — sandbox create options must stay credential-thin. */
export function daytonaSandboxCreateParams(snapshot: string): {
  snapshot: string;
  language: 'python';
  networkBlockAll: true;
  ephemeral: true;
  autoStopInterval: number;
  labels: { purpose: string };
} {
  return {
    snapshot,
    language: 'python',
    networkBlockAll: true,
    ephemeral: true,
    autoStopInterval: 5,
    labels: { purpose: 'timeline-document-extract' },
  };
}

async function withSandbox<T>(fn: (sandbox: Sandbox) => Promise<T>): Promise<T> {
  const env = getEnv();
  const daytona = createDaytonaClient();
  const snapshot = await resolveDocumentExtractSnapshotName(env.DAYTONA_SNAPSHOT);
  const sandbox = await daytona.create(daytonaSandboxCreateParams(snapshot), {
    timeout: 120,
  });
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

/** Exported for unit tests. */
export function parseSandboxJsonObject(stdout: string): Record<string, unknown> {
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

function readSandboxCommandJson(
  response: { exitCode: number; result: string },
  label: string,
): Record<string, unknown> {
  try {
    return parseSandboxJsonObject(response.result);
  } catch (err: unknown) {
    if (response.exitCode !== 0) {
      throw new Error(
        `${label} exited ${String(response.exitCode)} without usable JSON: ${response.result.slice(0, 300)}`,
      );
    }
    throw err;
  }
}

/** Exported for unit tests — incomplete downloads must fail closed. */
export async function downloadSandboxPageImages(
  sandbox: Pick<Sandbox, 'fs'>,
  paths: string[],
): Promise<Buffer[]> {
  const images: Buffer[] = [];
  for (const remotePath of paths) {
    if (typeof remotePath !== 'string' || remotePath.length === 0) {
      throw new Error('sandbox PDF extract returned an empty page image path');
    }
    try {
      const buf = await sandbox.fs.downloadFile(remotePath);
      if (buf.byteLength === 0) {
        throw new Error(`sandbox page image is empty: ${remotePath}`);
      }
      images.push(buf);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      // Fail closed: do not OCR a partial page set.
      throw new Error(`failed to download sandbox page image (${remotePath}): ${message}`);
    }
  }
  if (images.length !== paths.length) {
    throw new Error(
      `sandbox page image download incomplete: got ${String(images.length)} of ${String(paths.length)}`,
    );
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
    const parsed = readSandboxCommandJson(response, 'sandbox PDF extract');
    const text = typeof parsed.text === 'string' ? parsed.text : '';
    const method = typeof parsed.method === 'string' ? parsed.method : 'unknown';
    const pageCount = typeof parsed.pageCount === 'number' ? parsed.pageCount : 0;
    const sparse = parsed.sparse === true || text.trim().length < sparseChars;
    const pageImagePaths = Array.isArray(parsed.pageImagePaths)
      ? parsed.pageImagePaths.filter((p): p is string => typeof p === 'string')
      : [];
    const error = typeof parsed.error === 'string' ? parsed.error : undefined;
    const title =
      typeof parsed.title === 'string' && parsed.title.trim() ? parsed.title.trim() : undefined;
    let pageImages: Buffer[] = [];
    if (sparse && pageImagePaths.length > 0) {
      try {
        pageImages = await downloadSandboxPageImages(sandbox, pageImagePaths);
      } catch (err: unknown) {
        // Incomplete page PNGs must not reach vision — clear them so the
        // extract service OCRs the full PDF instead of a silent subset.
        log.warn(
          {
            err: err instanceof Error ? err.message : String(err),
            expected: pageImagePaths.length,
          },
          'sandbox page image download incomplete; omitting pageImages for full-PDF vision',
        );
        pageImages = [];
      }
    }

    // Empty text + no page images is still ok when sparse: caller falls back
    // to full-PDF vision. Hard-fail only when the sandbox produced nothing
    // usable and did not mark the result sparse (dense path with empty text).
    if (!text.trim() && pageImages.length === 0 && !sparse) {
      throw new Error(error ?? 'sandbox PDF extract produced no text or page images');
    }

    return {
      text,
      method,
      pageCount,
      sparse,
      pageImages,
      ...(title ? { title } : {}),
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
    const parsed = readSandboxCommandJson(response, 'sandbox DOCX extract');
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
