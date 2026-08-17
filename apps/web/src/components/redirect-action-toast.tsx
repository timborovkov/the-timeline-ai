'use client';

import { useEffect } from 'react';

import { notifyError, notifySuccess } from '@/lib/notify';

/**
 * Surfaces a completed redirect-result (OAuth callback, export download) on
 * the shared action-toast channel instead of a persistent page banner.
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
  useEffect(() => {
    if (error) {
      notifyError(id, error);
      return;
    }
    if (success) notifySuccess(id, success);
  }, [error, id, success]);
  return null;
}
