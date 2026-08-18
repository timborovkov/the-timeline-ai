'use client';

import { useEffect } from 'react';

import { displayActionError, notifyError, notifySuccess } from '@/lib/notify';

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
      notifyError(id, displayActionError(error, 'Couldn’t finish this action'));
      return;
    }
    if (success) notifySuccess(id, success);
  }, [error, id, success]);
  return null;
}
