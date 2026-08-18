import { notifyProgress } from '@/lib/notify';

/**
 * Long-running job-recovery batches update one loading toast in place.
 * `notifyProgress` owns the Sonner import and warning-tone mapping.
 */
export const jobsMutationToast = notifyProgress;

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
