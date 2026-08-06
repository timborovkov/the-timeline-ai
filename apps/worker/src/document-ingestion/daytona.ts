import { Daytona, type Sandbox } from '@daytonaio/sdk';
import { childLogger, getEnv } from '@timeline/shared';

import { resolveDocumentExtractSnapshotName } from '#src/document-ingestion/document-extract-snapshot.js';
import {
  maxVisionPages,
  type SandboxOfficeExtractResult,
  type SandboxPdfExtractResult,
} from '#src/document-ingestion/types.js';

const log = childLogger('worker:document-ingestion:daytona');

const REMOTE_WORK = '/tmp/timeline-extract';
const REMOTE_ANYDOC_SCRIPT = '/opt/timeline/extract_anydoc.py';

/** Keep two concurrent extract jobs well below the service memory ceiling. */
export const MAX_SANDBOX_PAGE_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_SANDBOX_PAGE_IMAGES_TOTAL_BYTES = 32 * 1024 * 1024;

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
  let expectedTotalBytes = 0;
  for (const remotePath of paths) {
    if (typeof remotePath !== 'string' || remotePath.length === 0) {
      throw new Error('sandbox PDF extract returned an empty page image path');
    }
    const details = await sandbox.fs.getFileDetails(remotePath);
    if (!Number.isSafeInteger(details.size) || details.size <= 0) {
      throw new Error(`sandbox page image has invalid size: ${remotePath}`);
    }
    if (details.size > MAX_SANDBOX_PAGE_IMAGE_BYTES) {
      throw new Error(
        `sandbox page image exceeds ${String(MAX_SANDBOX_PAGE_IMAGE_BYTES)} bytes: ${remotePath}`,
      );
    }
    expectedTotalBytes += details.size;
    if (expectedTotalBytes > MAX_SANDBOX_PAGE_IMAGES_TOTAL_BYTES) {
      throw new Error(
        `sandbox page images exceed ${String(MAX_SANDBOX_PAGE_IMAGES_TOTAL_BYTES)} aggregate bytes`,
      );
    }
  }

  const images: Buffer[] = [];
  let downloadedTotalBytes = 0;
  for (const remotePath of paths) {
    try {
      const buf = await sandbox.fs.downloadFile(remotePath);
      if (buf.byteLength === 0) {
        throw new Error(`sandbox page image is empty: ${remotePath}`);
      }
      if (buf.byteLength > MAX_SANDBOX_PAGE_IMAGE_BYTES) {
        throw new Error(
          `sandbox page image exceeds ${String(MAX_SANDBOX_PAGE_IMAGE_BYTES)} bytes: ${remotePath}`,
        );
      }
      downloadedTotalBytes += buf.byteLength;
      if (downloadedTotalBytes > MAX_SANDBOX_PAGE_IMAGES_TOTAL_BYTES) {
        throw new Error(
          `sandbox page images exceed ${String(MAX_SANDBOX_PAGE_IMAGES_TOTAL_BYTES)} aggregate bytes`,
        );
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

interface ExtractDocumentInDaytonaOptions {
  /** anydoc format hint (pdf, docx, pptx, …). */
  formatHint: string;
  /** Remote filename suffix / extension for the uploaded bytes. */
  remoteFilename?: string;
  timeoutSeconds?: number;
}

/**
 * Upload document bytes into a fresh Daytona sandbox, run the baked anydoc
 * extractor, and return text (+ optional page PNGs for sparse PDFs).
 */
async function extractDocumentInDaytonaSandbox(
  body: Buffer,
  options: ExtractDocumentInDaytonaOptions,
): Promise<SandboxPdfExtractResult> {
  const env = getEnv();
  const sparseChars = env.DOCUMENT_EXTRACT_SPARSE_TEXT_CHARS;
  const maxPages = maxVisionPages(env.DOCUMENT_EXTRACT_MAX_VISION_PAGES);
  const trimmedHint = options.formatHint.trim().toLowerCase();
  const formatHint = trimmedHint.length > 0 ? trimmedHint : 'pdf';
  const remoteName = options.remoteFilename?.trim() ?? `input.${formatHint}`;
  const timeoutSeconds = options.timeoutSeconds ?? (formatHint === 'pdf' ? 90 : 60);

  return withSandbox(async (sandbox) => {
    await sandbox.process.executeCommand(`mkdir -p ${REMOTE_WORK}/pages`);
    const remotePath = `${REMOTE_WORK}/${remoteName}`;
    await sandbox.fs.uploadFile(body, remotePath);

    const cmd = [
      'python3',
      REMOTE_ANYDOC_SCRIPT,
      '--input',
      remotePath,
      '--out-dir',
      REMOTE_WORK,
      '--sparse-chars',
      String(sparseChars),
      '--max-pages',
      String(maxPages),
      '--format',
      formatHint,
    ].join(' ');
    const response = await sandbox.process.executeCommand(
      cmd,
      undefined,
      undefined,
      timeoutSeconds,
    );
    const parsed = readSandboxCommandJson(response, 'sandbox anydoc extract');
    const text = typeof parsed.text === 'string' ? parsed.text : '';
    const method = typeof parsed.method === 'string' ? parsed.method : 'anydoc';
    const pageCount = typeof parsed.pageCount === 'number' ? parsed.pageCount : 0;
    const sparse =
      formatHint === 'pdf' ? parsed.sparse === true || text.trim().length < sparseChars : false;
    const pageImagePaths = Array.isArray(parsed.pageImagePaths)
      ? parsed.pageImagePaths.filter((p): p is string => typeof p === 'string')
      : [];
    const error = typeof parsed.error === 'string' ? parsed.error : undefined;
    const title =
      typeof parsed.title === 'string' && parsed.title.trim() ? parsed.title.trim() : undefined;
    let pageImages: Buffer[] = [];
    if (formatHint === 'pdf' && sparse && pageImagePaths.length > 0) {
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

    if (formatHint === 'pdf') {
      // Empty text + no page images is still ok when sparse: caller falls back
      // to full-PDF vision. Hard-fail only when the sandbox produced nothing
      // usable and did not mark the result sparse (dense path with empty text).
      if (!text.trim() && pageImages.length === 0 && !sparse) {
        throw new Error(error ?? 'sandbox PDF extract produced no text or page images');
      }
    } else if (parsed.ok !== true && !text.trim()) {
      throw new Error(error ?? 'sandbox anydoc extract failed');
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

/**
 * Upload PDF bytes into a fresh Daytona sandbox, run anydoc (+ optional
 * page PNG render), and return text + optional page PNGs for vision.
 */
export async function extractPdfInDaytonaSandbox(body: Buffer): Promise<SandboxPdfExtractResult> {
  return extractDocumentInDaytonaSandbox(body, {
    formatHint: 'pdf',
    remoteFilename: 'input.pdf',
    timeoutSeconds: 90,
  });
}

/** Upload office bytes into a Daytona sandbox and return anydoc Markdown. */
export async function extractOfficeInDaytonaSandbox(
  body: Buffer,
  formatHint: string,
): Promise<SandboxOfficeExtractResult> {
  const result = await extractDocumentInDaytonaSandbox(body, {
    formatHint,
    remoteFilename: `input.${formatHint}`,
    timeoutSeconds: 60,
  });
  return {
    text: result.text,
    method: result.method,
    ...(result.error ? { error: result.error } : {}),
  };
}

export function isDaytonaConfigured(): boolean {
  return Boolean(getEnv().DAYTONA_API_KEY);
}
