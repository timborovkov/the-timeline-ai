import { toast } from 'sonner';

/**
 * Linear-style mutation toast: one loading toast that becomes success, warning,
 * or error. Swap this for the shared `toastMutation` helper when that lands.
 */
export async function jobsMutationToast<T>(
  work: (update: (message: string) => void) => Promise<T>,
  messages: {
    loading: string;
    success: string | ((result: T) => string);
    error?: string | ((error: unknown) => string);
    tone?: (result: T) => 'success' | 'warning';
  },
): Promise<T> {
  const toastId = toast.loading(messages.loading);
  try {
    const result = await work((message) => {
      toast.loading(message, { id: toastId });
    });
    const text =
      typeof messages.success === 'function' ? messages.success(result) : messages.success;
    if (messages.tone?.(result) === 'warning') {
      toast.warning(text, { id: toastId });
    } else {
      toast.success(text, { id: toastId });
    }
    return result;
  } catch (error) {
    toast.error(
      typeof messages.error === 'function'
        ? messages.error(error)
        : (messages.error ?? (error instanceof Error ? error.message : 'Something went wrong')),
      { id: toastId },
    );
    throw error;
  }
}

export async function postJson<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    ...(body === undefined
      ? {}
      : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text.trim() || `Request failed (${String(res.status)})`);
  }
  return (await res.json().catch(() => ({}))) as T;
}
