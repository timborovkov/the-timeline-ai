import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { Worker, type WorkerOptions } from 'node:worker_threads';

import { type NativePdfExtractResult } from '#src/workers/pdfNativeExtract.js';

/**
 * Run `@firecrawl/pdf-inspector` off the main event loop.
 *
 * The package is loaded only inside the thread (lazy + platform-safe): a
 * missing darwin-x64 (or other) binary fails this call and lets the PDF
 * router fall back to vision instead of crashing worker process startup.
 *
 * Module resolution is anchored to this file (via `createRequire`), not
 * `process.cwd()`. That matters on Railway, where the worker starts as
 * `node apps/worker/dist/index.js` from the repo root — a bare
 * `import('@firecrawl/pdf-inspector')` inside an eval worker would look
 * in root `node_modules` and miss the pnpm link under `apps/worker`.
 *
 * Bounded timeout so a wedged native parse cannot stall BullMQ forever.
 */
const NATIVE_PDF_THREAD_TIMEOUT_MS = 60_000;

const requireFromThisModule = createRequire(import.meta.url);

/** True when the worker package can resolve + load the native binding. */
export function isPdfInspectorNativeSupported(): boolean {
  try {
    // Resolving is not enough — the package loads a platform optional
    // binary at require-time. Probe that here so Darwin x64 (and peers)
    // report unsupported instead of failing later in the thread.
    requireFromThisModule.resolve('@firecrawl/pdf-inspector');
    requireFromThisModule('@firecrawl/pdf-inspector');
    return true;
  } catch {
    return false;
  }
}

function resolvePdfInspectorModuleUrl(): string {
  return pathToFileURL(requireFromThisModule.resolve('@firecrawl/pdf-inspector')).href;
}

const THREAD_SOURCE = `
import { parentPort, workerData } from 'node:worker_threads';

const bytes = workerData.pdfBytes;
const moduleUrl = workerData.moduleUrl;
if (!parentPort) {
  throw new Error('pdf-inspector thread missing parentPort');
}
if (typeof moduleUrl !== 'string' || moduleUrl.length === 0) {
  parentPort.postMessage({ ok: false, error: 'pdf-inspector thread missing moduleUrl' });
} else if (!bytes || !(bytes instanceof Uint8Array)) {
  parentPort.postMessage({ ok: false, error: 'pdf-inspector thread missing pdfBytes' });
} else {
  import(moduleUrl)
    .then(({ processPdf }) => {
      const result = processPdf(Buffer.from(bytes));
      parentPort.postMessage({
        ok: true,
        result: {
          pdfType: result.pdfType,
          confidence: result.confidence,
          hasEncodingIssues: result.hasEncodingIssues,
          markdown: result.markdown,
          title: result.title,
        },
      });
    })
    .catch((err) => {
      parentPort.postMessage({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    });
}
`;

interface ThreadSuccess {
  ok: true;
  result: {
    pdfType: NativePdfExtractResult['pdfType'];
    confidence: number;
    hasEncodingIssues: boolean;
    markdown?: string;
    title?: string;
  };
}

interface ThreadFailure {
  ok: false;
  error: string;
}

type ThreadMessage = ThreadSuccess | ThreadFailure;

function isThreadMessage(value: unknown): value is ThreadMessage {
  if (typeof value !== 'object' || value === null || !('ok' in value)) {
    return false;
  }
  return typeof value.ok === 'boolean';
}

function processPdfNativeOnMainThread(body: Buffer): NativePdfExtractResult {
  // Load via createRequire (same resolution base as the off-thread path) so
  // process.cwd() cannot change which package we get.
  const mod = requireFromThisModule('@firecrawl/pdf-inspector') as {
    processPdf: (buffer: Buffer) => {
      pdfType: NativePdfExtractResult['pdfType'];
      confidence: number;
      hasEncodingIssues: boolean;
      markdown?: string;
      title?: string;
    };
  };
  const result = mod.processPdf(body);
  return {
    pdfType: result.pdfType,
    confidence: result.confidence,
    hasEncodingIssues: result.hasEncodingIssues,
    ...(result.markdown !== undefined ? { markdown: result.markdown } : {}),
    ...(result.title ? { title: result.title } : {}),
  };
}

export async function processPdfNativeOffThread(body: Buffer): Promise<NativePdfExtractResult> {
  const moduleUrl = resolvePdfInspectorModuleUrl();

  if (process.env.TIMELINE_PDF_NATIVE_MAIN_THREAD === '1') {
    return Promise.resolve(processPdfNativeOnMainThread(body));
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    // Node supports type:'module' for eval workers; @types/node lags behind.
    const workerOptions = {
      eval: true,
      type: 'module',
      workerData: {
        pdfBytes: new Uint8Array(body),
        moduleUrl,
      },
    } as WorkerOptions;
    const worker = new Worker(THREAD_SOURCE, workerOptions);

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      void worker.terminate();
      reject(new Error(`pdf-inspector timed out after ${String(NATIVE_PDF_THREAD_TIMEOUT_MS)}ms`));
    }, NATIVE_PDF_THREAD_TIMEOUT_MS);

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };

    worker.once('message', (msg: unknown) => {
      finish(() => {
        void worker.terminate();
        if (!isThreadMessage(msg)) {
          reject(new Error('pdf-inspector thread returned an invalid message'));
          return;
        }
        if (!msg.ok) {
          reject(new Error(msg.error || 'pdf-inspector thread failed'));
          return;
        }
        resolve({
          pdfType: msg.result.pdfType,
          confidence: msg.result.confidence,
          hasEncodingIssues: msg.result.hasEncodingIssues,
          ...(msg.result.markdown !== undefined ? { markdown: msg.result.markdown } : {}),
          ...(msg.result.title ? { title: msg.result.title } : {}),
        });
      });
    });

    worker.once('error', (err: Error) => {
      finish(() => {
        reject(err);
      });
    });

    worker.once('exit', (code) => {
      // Successful runs settle on `message` before terminate/exit. An exit
      // without a prior message means the thread died early.
      finish(() => {
        reject(new Error(`pdf-inspector thread exited with code ${String(code)}`));
      });
    });
  });
}
