import { toast } from 'sonner';

export interface MutationToastMessages<T extends MutationResult = MutationResult> {
  loading: string;
  success: string;
  error?: string;
  undo?: (result: T) => { label?: string; onClick: () => void | Promise<void> } | undefined;
}

export interface MutationResult {
  ok?: boolean;
  error?: string;
}

function resultError(result: MutationResult, fallback: string): string | null {
  if (result.error) return result.error;
  if (result.ok === false) return fallback;
  return null;
}

export async function toastMutation<T extends MutationResult>(
  work: Promise<T> | (() => Promise<T>),
  messages: MutationToastMessages<T>,
): Promise<T> {
  const promise = typeof work === 'function' ? work() : work;
  const toastId = toast.loading(messages.loading);
  const fallbackError = messages.error ?? 'Something went wrong';
  try {
    const result = await promise;
    const error = resultError(result, fallbackError);
    if (error) {
      toast.error(error, { id: toastId });
      return result;
    }
    const undo = messages.undo?.(result);
    toast.success(messages.success, {
      id: toastId,
      ...(undo
        ? {
            action: {
              label: undo.label ?? 'Undo',
              onClick: () => {
                void undo.onClick();
              },
            },
          }
        : {}),
    });
    return result;
  } catch (err) {
    toast.error(err instanceof Error && err.message ? err.message : fallbackError, {
      id: toastId,
    });
    throw err;
  }
}
