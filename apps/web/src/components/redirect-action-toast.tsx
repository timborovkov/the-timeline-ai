'use client';

import { useEffect } from 'react';

import { notifyError, notifySuccess } from '@/lib/notify';

const announcedRedirects = new Set<string>();

function announceRedirect(id: string, error?: string | null, success?: string | null): void {
  const key = `${id}:${error ?? ''}:${success ?? ''}`;
  if ((!error && !success) || announcedRedirects.has(key)) return;
  announcedRedirects.add(key);
  if (error) notifyError(id, error);
  else if (success) notifySuccess(id, success);
}

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
  // A provider redirect has no local event handler. Synchronize its completed
  // result with the external toast system only after the client commits.
  useEffect(() => {
    announceRedirect(id, error, success);
  }, [id, error, success]);
  return null;
}
