'use client';

import { useEffect, useRef } from 'react';
import { toast } from 'sonner';

import {
  ACTION_TOAST_ERROR_MS,
  ACTION_TOAST_LOADING_DELAY_MS,
  ACTION_TOAST_SUCCESS_MS,
} from '@/lib/notify';

/**
 * Bridges native form actions (`useActionState` / `useFormStatus`) onto the
 * shared action-toast lifecycle. Field validation stays inline; this only
 * reports pending, success, and non-field server failures.
 */
export function useFormActionToast({
  id,
  pending,
  error,
  success,
  loading = 'Saving changes…',
  fieldError = false,
}: {
  id: string;
  pending: boolean;
  error?: string | null;
  success?: string | null;
  loading?: string;
  fieldError?: boolean;
}): void {
  const lastError = useRef<string | null>(null);
  const lastSuccess = useRef<string | null>(null);

  useEffect(() => {
    if (pending) {
      lastError.current = null;
      lastSuccess.current = null;
      const timer = window.setTimeout(() => {
        toast.loading(loading, { id, duration: Infinity });
      }, ACTION_TOAST_LOADING_DELAY_MS);
      return () => {
        window.clearTimeout(timer);
      };
    }

    if (error && !fieldError && error !== lastError.current) {
      toast.error(error, { id, duration: ACTION_TOAST_ERROR_MS });
    } else if (success && !error && success !== lastSuccess.current) {
      toast.success(success, { id, duration: ACTION_TOAST_SUCCESS_MS });
    } else {
      toast.dismiss(id);
    }

    lastError.current = error ?? null;
    lastSuccess.current = success ?? null;
    return undefined;
  }, [error, fieldError, id, loading, pending, success]);
}
