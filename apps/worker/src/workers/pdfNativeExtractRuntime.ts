import { Worker, type WorkerOptions } from 'node:worker_threads';

import { type NativePdfExtractResult } from '#src/workers/pdfNativeExtract.js';

/**
 * Run `@firecrawl/pdf-inspector` off the main event loop.
 *
 * The package is loaded only inside the thread (lazy + platform-safe): a
 * missing darwin-x64 (or other) binary fails this call and lets the PDF
 * router fall back to vision instead of crashing worker process startup.
 *
 * Bounded timeout so a wedged native parse cannot stall BullMQ forever.
 */
const NATIVE_PDF_THREAD_TIMEOUT_MS = 60_000;

const THREAD_SOURCE = `
import { parentPort, workerData } from 'node:worker_threads';

const bytes = workerData.pdfBytes;
if (!parentPort) {
  throw new Error('pdf-inspector thread missing parentPort');
}
if (!bytes || !(bytes instanceof Uint8Array)) {
  parentPort.postMessage({ ok: false, error: 'pdf-inspector thread missing pdfBytes' });
} else {
  import('@firecrawl/pdf-inspector')
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

async function processPdfNativeOnMainThread(body: Buffer): Promise<NativePdfExtractResult> {
  // Dynamic import keeps this off the worker startup path while still giving
  // knip/packaging a resolvable dependency edge (the thread loads via eval).
  const { processPdf } = await import('@firecrawl/pdf-inspector');
  const result = processPdf(body);
  return {
    pdfType: result.pdfType,
    confidence: result.confidence,
    hasEncodingIssues: result.hasEncodingIssues,
    ...(result.markdown !== undefined ? { markdown: result.markdown } : {}),
    ...(result.title ? { title: result.title } : {}),
  };
}

export async function processPdfNativeOffThread(body: Buffer): Promise<NativePdfExtractResult> {
  if (process.env.TIMELINE_PDF_NATIVE_MAIN_THREAD === '1') {
    return processPdfNativeOnMainThread(body);
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    // Node supports type:'module' for eval workers; @types/node lags behind.
    const workerOptions = {
      eval: true,
      type: 'module',
      workerData: { pdfBytes: new Uint8Array(body) },
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
