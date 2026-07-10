import { randomUUID } from 'node:crypto';

import { reportCaughtError } from '@/lib/sentry-report';

type ErrorSurface = 'api' | 'server_action';

interface ExpectedError {
  message: string;
  status?: number;
}

interface PublicErrorOptions {
  operation: string;
  surface: ErrorSurface;
  expected?: Record<string, ExpectedError>;
}

function errorKey(err: unknown): string | null {
  if (!err || typeof err !== 'object') return null;
  const code = (err as { code?: unknown }).code;
  if (typeof code === 'string') return code;
  const message = (err as { message?: unknown }).message;
  return typeof message === 'string' ? message : null;
}

function classifyPublicError(
  err: unknown,
  options: PublicErrorOptions,
): { expected: ExpectedError } | { reference: string } {
  const key = errorKey(err);
  const expected = key ? options.expected?.[key] : undefined;
  if (expected) return { expected };

  const reference = randomUUID().slice(0, 8);
  reportCaughtError(err, {
    surface: options.surface,
    operation: options.operation,
    tags: { error_reference: reference },
  });
  return { reference };
}

export function publicActionError(
  err: unknown,
  options: Omit<PublicErrorOptions, 'surface'> & { fallback: string },
): string {
  const result = classifyPublicError(err, { ...options, surface: 'server_action' });
  return 'expected' in result
    ? result.expected.message
    : `${options.fallback} Reference: ${result.reference}.`;
}

export function publicApiError(
  err: unknown,
  options: Omit<PublicErrorOptions, 'surface'> & {
    fallbackCode: string;
    fallbackStatus?: number;
  },
): { error: string; status: number; reference?: string } {
  const result = classifyPublicError(err, { ...options, surface: 'api' });
  if ('expected' in result) {
    return {
      error: result.expected.message,
      status: result.expected.status ?? options.fallbackStatus ?? 400,
    };
  }
  return {
    error: options.fallbackCode,
    status: options.fallbackStatus ?? 500,
    reference: result.reference,
  };
}
