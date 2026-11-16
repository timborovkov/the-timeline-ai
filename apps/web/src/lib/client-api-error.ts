import { ApiResponseError, readJson } from '@/lib/api-response';

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
  try {
    await readJson(response);
  } catch (error) {
    if (error instanceof ApiResponseError) {
      const message = error.code ? (PUBLIC_ERROR_MESSAGES[error.code] ?? fallback) : fallback;
      return error.reference ? `${message} Reference: ${error.reference}.` : message;
    }
  }
  return fallback;
}

export function networkActionError(action: string): string {
  return `Could not ${action} because the network request failed. Check your connection and try again.`;
}
