interface PublicErrorPayload {
  error?: unknown;
  reference?: unknown;
}

const PUBLIC_ERROR_MESSAGES: Record<string, string> = {
  forbidden: 'You do not have permission to make this change.',
  not_found: 'This item no longer exists. Refresh the page and try again.',
  add_failed: 'The server could not be added. Check its settings and try again.',
  update_failed: 'The server could not be updated. Try again.',
  delete_failed: 'The server could not be removed. Try again.',
  revoke_failed: 'The key could not be revoked. Try again.',
  create_failed: 'The key could not be created. Try again.',
};

export async function readPublicApiError(response: Response, fallback: string): Promise<string> {
  const payload = (await response.json().catch(() => null)) as PublicErrorPayload | null;
  const code = typeof payload?.error === 'string' ? payload.error : null;
  const reference = typeof payload?.reference === 'string' ? payload.reference : null;
  const message = code ? (PUBLIC_ERROR_MESSAGES[code] ?? fallback) : fallback;
  return reference ? `${message} Reference: ${reference}.` : message;
}

export function networkActionError(action: string): string {
  return `Could not ${action} because the network request failed. Check your connection and try again.`;
}
