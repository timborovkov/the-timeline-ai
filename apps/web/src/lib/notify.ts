'use client';

import { toast } from 'sonner';

export const ACTION_TOAST_LOADING_DELAY_MS = 150;
export const ACTION_TOAST_SUCCESS_MS = 2_000;
export const ACTION_TOAST_ERROR_MS = 6_000;

export interface ActionResult {
  error?: string;
  ok?: boolean;
  id?: string;
  failedItemIds?: string[];
}

interface NotifyUndo<T extends ActionResult = ActionResult> {
  run: (result: T) => Promise<ActionResult>;
  loading?: string;
  success?: string;
  error?: string;
}

export interface NotifyActionOptions<T extends ActionResult = ActionResult> {
  id: string;
  loading: string;
  success: string;
  error: string;
  run: () => Promise<T>;
  undo?: NotifyUndo<T>;
}

const generations = new Map<string, number>();

function nextGeneration(id: string): number {
  const generation = (generations.get(id) ?? 0) + 1;
  generations.set(id, generation);
  return generation;
}

function isCurrent(id: string, generation: number): boolean {
  return generations.get(id) === generation;
}

function resultError(result: ActionResult | undefined): string | undefined {
  return result?.error;
}

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;

export function displayActionError(resultMessage: string | undefined, fallback: string): string {
  if (!resultMessage || resultMessage === fallback) return fallback;
  if (!/[\s'’]/.test(resultMessage)) return fallback;
  if (UUID_RE.test(resultMessage)) return fallback;
  if (/^update failed\b/i.test(resultMessage)) return fallback;
  return resultMessage;
}

export async function notifyAction<T extends ActionResult>(
  options: NotifyActionOptions<T>,
): Promise<T | { error: string }> {
  const generation = nextGeneration(options.id);
  const loadingTimer = setTimeout(() => {
    if (!isCurrent(options.id, generation)) return;
    toast.loading(options.loading, { id: options.id, duration: Infinity });
  }, ACTION_TOAST_LOADING_DELAY_MS);

  const finish = (failed: boolean, message: string, undo?: NotifyUndo<T>, result?: T): void => {
    clearTimeout(loadingTimer);
    if (!isCurrent(options.id, generation)) return;
    if (failed) {
      toast.error(message, { id: options.id, duration: ACTION_TOAST_ERROR_MS });
      return;
    }
    toast.success(message, {
      id: options.id,
      duration: ACTION_TOAST_SUCCESS_MS,
      action: undo
        ? {
            label: 'Undo',
            onClick: () => {
              void notifyAction({
                id: options.id,
                loading: undo.loading ?? 'Undoing…',
                success: undo.success ?? 'Undone',
                error: undo.error ?? 'Couldn’t undo',
                run: () => undo.run(result ?? ({} as T)),
              });
            },
          }
        : undefined,
    });
  };

  try {
    const result = await options.run();
    const failed = Boolean(resultError(result));
    finish(
      failed,
      failed ? displayActionError(resultError(result), options.error) : options.success,
      failed ? undefined : options.undo,
      result,
    );
    return result;
  } catch {
    finish(true, options.error);
    return { error: options.error };
  } finally {
    clearTimeout(loadingTimer);
  }
}

export function notifyError(id: string, message: string): void {
  nextGeneration(id);
  toast.error(message, { id, duration: ACTION_TOAST_ERROR_MS });
}

export function notifySuccess(id: string, message: string): void {
  nextGeneration(id);
  toast.success(message, { id, duration: ACTION_TOAST_SUCCESS_MS });
}

export function resetNotifyActionState(): void {
  generations.clear();
}
