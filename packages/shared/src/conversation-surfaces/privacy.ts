const SAFE_CONVERSATION_ERROR_MESSAGE = 'Conversation operation failed';

function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object' || !('code' in error)) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' || typeof code === 'number' ? String(code) : undefined;
}

/**
 * Drizzle includes bound query parameters in its error message. Conversation
 * parameters contain private questions and answers, so provider/worker
 * boundaries must never send the original error object to logs or Sentry.
 */
export function redactConversationError(error: unknown): Error & { code?: string } {
  const safe = new Error(SAFE_CONVERSATION_ERROR_MESSAGE) as Error & { code?: string };
  safe.name = error instanceof Error ? error.name : 'Error';
  const code = errorCode(error);
  if (code) safe.code = code;
  return safe;
}
