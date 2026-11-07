interface ApiErrorPayload {
  acceptanceUrl?: unknown;
  error?: unknown;
  reference?: unknown;
}

type Navigate = (path: string) => void;
const LEGAL_ACCEPTANCE_REDIRECT = '/legal/accept?returnTo=%2Fapp';

export class ApiResponseError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
    readonly reference: string | null,
    readonly acceptanceUrl: string | null,
    fallback: string,
  ) {
    super(`${fallback}${reference ? ` Reference: ${reference}.` : ''}`);
    this.name = 'ApiResponseError';
  }
}

function navigateBrowser(path: string): void {
  if (typeof window !== 'undefined') window.location.assign(path);
}

export async function readJson<T>(
  response: Response,
  options: { navigate?: Navigate; emptyValue?: T; fallbackMessage?: string } = {},
): Promise<T> {
  const fallback = options.fallbackMessage ?? `Request failed (${String(response.status)})`;
  const text = await response.text();
  let data: unknown;
  if (text.trim()) {
    try {
      data = JSON.parse(text) as unknown;
    } catch {
      throw new ApiResponseError(
        response.status,
        null,
        null,
        null,
        response.ok ? 'Invalid server response.' : fallback,
      );
    }
  }
  if (!response.ok) {
    const payload: ApiErrorPayload = data && typeof data === 'object' ? data : {};
    const code = typeof payload.error === 'string' ? payload.error : null;
    const reference = typeof payload.reference === 'string' ? payload.reference : null;
    const acceptanceUrl =
      response.status === 428 &&
      code === 'legal_acceptance_required' &&
      payload.acceptanceUrl === LEGAL_ACCEPTANCE_REDIRECT
        ? LEGAL_ACCEPTANCE_REDIRECT
        : null;
    if (acceptanceUrl) (options.navigate ?? navigateBrowser)(acceptanceUrl);
    throw new ApiResponseError(response.status, code, reference, acceptanceUrl, fallback);
  }
  if (!text.trim()) {
    if ('emptyValue' in options) return options.emptyValue as T;
    throw new ApiResponseError(response.status, null, null, null, 'Empty server response.');
  }
  return data as T;
}

export async function postJson<T>(url: string, body?: unknown): Promise<T> {
  return readJson<T>(
    await fetch(url, {
      method: 'POST',
      ...(body === undefined
        ? {}
        : {
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          }),
    }),
  );
}
