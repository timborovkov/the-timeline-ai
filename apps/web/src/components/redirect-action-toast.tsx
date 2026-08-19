'use client';

import { notifyError, notifySuccess } from '@/lib/notify';

const announcedRedirects = new Set<string>();

/**
 * Surfaces a completed redirect-result (OAuth callback, export download) on
 * the shared action-toast channel instead of a persistent page banner.
 * Callers pass already-mapped sentence-like copy.
 */
export function RedirectActionToast({
  id,
  error,
  success,
}: {
  id: string;
  error?: string | null;
  success?: string | null;
}) {
  const key = `${id}:${error ?? ''}:${success ?? ''}`;
  if ((error || success) && !announcedRedirects.has(key)) {
    announcedRedirects.add(key);
    if (error) notifyError(id, error);
    else if (success) notifySuccess(id, success);
  }
  return null;
}
