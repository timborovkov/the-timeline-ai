'use client';

import { useFormStatus } from 'react-dom';

import { useFormActionToast } from '@/lib/form-action-toast';

export function FormActionToast({
  id,
  error,
  success,
  loading,
  fieldError = false,
}: {
  id: string;
  error?: string | null;
  success?: string | null;
  loading?: string;
  fieldError?: boolean;
}) {
  const { pending } = useFormStatus();
  useFormActionToast({ id, pending, error, success, loading, fieldError });
  return null;
}
