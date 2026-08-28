interface ApiErrorPayload {
  acceptanceUrl?: unknown;
  error?: unknown;
}

type Navigate = (path: string) => void;

const LEGAL_ACCEPTANCE_REDIRECT = '/legal/accept?returnTo=%2Fapp';

function legalAcceptanceRedirect(data: ApiErrorPayload): string | null {
  return data.error === 'legal_acceptance_required' &&
    data.acceptanceUrl === LEGAL_ACCEPTANCE_REDIRECT
    ? LEGAL_ACCEPTANCE_REDIRECT
    : null;
}

function navigateBrowser(path: string): void {
  if (typeof window !== 'undefined') window.location.assign(path);
}

export async function readJson<T>(res: Response, navigate: Navigate = navigateBrowser): Promise<T> {
  const data = (await res.json()) as T & ApiErrorPayload;
  if (!res.ok) {
    const redirectPath = res.status === 428 ? legalAcceptanceRedirect(data) : null;
    if (redirectPath) navigate(redirectPath);
    throw new Error(
      typeof data.error === 'string' ? data.error : `Request failed (${String(res.status)})`,
    );
  }
  return data;
}
