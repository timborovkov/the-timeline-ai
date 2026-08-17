'use client';

const DISMISS_OLDER_PREVIEW_BATCH = 500;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit): string {
  if (init?.method) return init.method.toUpperCase();
  if (typeof input !== 'string' && !(input instanceof URL)) return input.method.toUpperCase();
  return 'GET';
}

function requestBody(init?: RequestInit): Record<string, unknown> {
  return typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {};
}

/**
 * Preview-only fetch stubs so dismiss/retry/load-more can be click-tested
 * without a live recovery queue. Delay keeps loading toasts visible.
 */
export function installJobsPreviewMocks(opts: { olderCount: number }): () => void {
  const originalFetch = window.fetch.bind(window);
  let olderRemaining = opts.olderCount;

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = requestUrl(input);
    const method = requestMethod(input, init);
    if (!url.includes('/api/team/job-recovery') && !url.includes('/api/jobs/dashboard')) {
      return originalFetch(input, init);
    }
    await new Promise((resolve) => {
      window.setTimeout(resolve, 180);
    });

    if (url.includes('/api/jobs/dashboard')) {
      return jsonResponse({
        updatedAt: '2026-08-17T15:00:00.000Z',
        summaries: [
          { kind: 'extraction', label: 'Extraction', needsAttention: 128 },
          { kind: 'embedding', label: 'Embedding', needsAttention: 41 },
        ],
      });
    }

    if (url.includes('/api/team/job-recovery/finished')) {
      const offset = Number(new URL(url, 'http://preview.local').searchParams.get('offset') ?? '0');
      if (offset > 0) return jsonResponse({ items: [], nextOffset: null });
      return jsonResponse({
        items: [
          {
            id: 'finished-1',
            queue: 'extract',
            name: 'extract',
            kind: 'extraction',
            artifactKind: 'raw_event',
            artifactId: 'raw-finished-1',
            label: 'Extraction · weekly notes',
            status: 'completed',
            attemptsMade: 1,
            processedAt: '2026-08-17T14:00:00.000Z',
            finishedAt: '2026-08-17T14:01:00.000Z',
            error: null,
          },
          {
            id: 'finished-2',
            queue: 'embed',
            name: 'embed',
            kind: 'embedding',
            artifactKind: 'calendar_event',
            artifactId: 'cal-finished-2',
            label: 'Embedding · standup',
            status: 'failed',
            attemptsMade: 3,
            processedAt: '2026-08-17T14:10:00.000Z',
            finishedAt: '2026-08-17T14:12:00.000Z',
            error: 'provider unavailable',
          },
        ],
        nextOffset: 20,
      });
    }

    if (url.includes('/api/team/job-recovery/dismiss-matching') && method === 'POST') {
      const body = requestBody(init);
      if (body.window === 'older') {
        const dismissed = Math.min(DISMISS_OLDER_PREVIEW_BATCH, olderRemaining);
        olderRemaining -= dismissed;
        return jsonResponse({ ok: true, dismissed, remaining: olderRemaining });
      }
      return jsonResponse({ ok: true, dismissed: 1, remaining: 0 });
    }

    if (url.includes('/api/team/job-recovery/retry-failed') && method === 'POST') {
      const body = requestBody(init);
      const expected = typeof body.expectedCount === 'number' ? body.expectedCount : 0;
      return jsonResponse({ retried: expected, failed: 0, failedIds: [] });
    }

    if (url.includes('/api/team/job-recovery/resuggest') && method === 'POST') {
      return jsonResponse({ enqueued: 4, scanned: 12, truncated: false });
    }

    if ((url.includes('/retry') || url.includes('/dismiss')) && method === 'POST') {
      return jsonResponse({ ok: true });
    }

    return originalFetch(input, init);
  };

  return () => {
    window.fetch = originalFetch;
  };
}
