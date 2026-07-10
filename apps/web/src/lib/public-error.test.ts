import { describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({ reportCaughtError: vi.fn() }));
vi.mock('@/lib/sentry-report', () => ({ reportCaughtError: fakes.reportCaughtError }));

const { publicActionError, publicApiError } = await import('@/lib/public-error');

/** Unexpected internals stay server-side while known domain errors remain actionable. */
describe('public errors', () => {
  it('maps an expected domain error without reporting it', () => {
    expect(
      publicApiError(new Error('not_found'), {
        operation: 'retry_job',
        fallbackCode: 'retry_failed',
        expected: { not_found: { message: 'not_found', status: 404 } },
      }),
    ).toEqual({ error: 'not_found', status: 404 });
    expect(fakes.reportCaughtError).not.toHaveBeenCalled();
  });

  it('hides unexpected details and returns a correlation reference', () => {
    const result = publicApiError(new Error('password=secret SQL failed'), {
      operation: 'retry_job',
      fallbackCode: 'retry_failed',
    });
    expect(result).toMatchObject({ error: 'retry_failed', status: 500 });
    expect(result.reference).toMatch(/^[0-9a-f]{8}$/);
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(fakes.reportCaughtError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        operation: 'retry_job',
        tags: { error_reference: result.reference },
      }),
    );
  });

  it('returns a safe action fallback with the same reference contract', () => {
    const message = publicActionError(new Error('postgres://internal'), {
      operation: 'create_board',
      fallback: 'Failed to create board.',
    });
    expect(message).toMatch(/^Failed to create board\. Reference: [0-9a-f]{8}\.$/);
    expect(message).not.toContain('postgres');
  });
});
