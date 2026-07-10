'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { type ActionState, resolveScope, uuidSchema } from '@/lib/action-scope';
import { publicActionError } from '@/lib/public-error';
import { runSentryServerAction } from '@/lib/sentry-action';

const EXPECTED_SUGGESTION_APPLY_FAILURE_CODE = 'TIMELINE_EXPECTED_SUGGESTION_APPLY_FAILURE';
const MAX_VISIBLE_ACCEPT_ITEMS = 500;
const MAX_VISIBLE_REJECT_ITEMS = 500;

function revalidateSuggestionSurfaces() {
  revalidatePath('/app');
  revalidatePath('/app/approvals');
  revalidatePath('/app/timeline');
  revalidatePath('/app/objects', 'layout');
  revalidatePath('/app/boards', 'layout');
  revalidatePath('/app/calendar');
  revalidatePath('/app/tasks');
  revalidatePath('/app/inbox');
}

function isExpectedSuggestionApplyFailure(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const code = (err as { code?: unknown }).code;
  if (code === EXPECTED_SUGGESTION_APPLY_FAILURE_CODE) return true;
  if ((err as { name?: unknown }).name === 'ExpectedSuggestionApplyFailure') return true;
  const cause = (err as { cause?: unknown }).cause;
  if (cause && isExpectedSuggestionApplyFailure(cause)) return true;
  return false;
}

function errorMessage(err: unknown, fallback: string): string {
  return err &&
    typeof err === 'object' &&
    typeof (err as { message?: unknown }).message === 'string'
    ? (err as { message: string }).message
    : fallback;
}

export async function acceptSuggestionItemAction(input: unknown): Promise<ActionState> {
  return runSentryServerAction('accept_suggestion_item', async () => {
    const parsed = z.object({ itemId: uuidSchema }).safeParse(input);
    if (!parsed.success) return { error: 'Invalid suggestion item id' };
    const r = await resolveScope();
    if (!r.ok) return { error: r.error };
    try {
      const ok = await r.scope.suggestions.acceptSuggestionItem(parsed.data.itemId);
      if (!ok) return { error: 'Suggestion item no longer pending' };
      revalidateSuggestionSurfaces();
      return { ok: true };
    } catch (err) {
      return {
        error: isExpectedSuggestionApplyFailure(err)
          ? errorMessage(err, 'Failed to accept suggestion')
          : publicActionError(err, {
              operation: 'accept_suggestion_item',
              fallback: 'Failed to accept suggestion.',
            }),
      };
    }
  });
}

export async function rejectSuggestionItemAction(input: unknown): Promise<ActionState> {
  return runSentryServerAction('reject_suggestion_item', async () => {
    const parsed = z.object({ itemId: uuidSchema }).safeParse(input);
    if (!parsed.success) return { error: 'Invalid suggestion item id' };
    const r = await resolveScope();
    if (!r.ok) return { error: r.error };
    try {
      const ok = await r.scope.suggestions.rejectSuggestionItem(parsed.data.itemId);
      if (!ok) return { error: 'Suggestion item no longer pending' };
      revalidateSuggestionSurfaces();
      return { ok: true };
    } catch (err) {
      return {
        error: publicActionError(err, {
          operation: 'reject_suggestion_item',
          fallback: 'Failed to reject suggestion.',
        }),
      };
    }
  });
}

export async function rejectVisibleSuggestionsAction(input: unknown): Promise<ActionState> {
  return runSentryServerAction('reject_visible_suggestions', async () => {
    const parsed = z
      .object({
        suggestions: z
          .array(
            z.object({
              suggestionId: uuidSchema,
              itemIds: z.array(uuidSchema).min(1).max(MAX_VISIBLE_REJECT_ITEMS),
            }),
          )
          .min(1)
          .max(200),
      })
      .refine(
        (data) =>
          data.suggestions.reduce((sum, suggestion) => sum + suggestion.itemIds.length, 0) <=
          MAX_VISIBLE_REJECT_ITEMS,
      )
      .safeParse(input);
    if (!parsed.success) return { error: 'Invalid suggestion items' };
    const r = await resolveScope();
    if (!r.ok) return { error: r.error };
    try {
      const itemIds = [
        ...new Set(parsed.data.suggestions.flatMap((suggestion) => suggestion.itemIds)),
      ];
      const results: boolean[] = [];
      await itemIds.reduce<Promise<void>>(
        (previousResults, itemId) =>
          previousResults.then((settledResults) =>
            r.scope.suggestions.rejectSuggestionItem(itemId).then((result) => {
              results.push(result);
              return settledResults;
            }),
          ),
        Promise.resolve(),
      );
      const failedItemIds = itemIds.filter((_, index) => results[index] === false);
      const failed = failedItemIds.length;
      if (failed === 0) revalidateSuggestionSurfaces();
      return failed > 0
        ? { error: `${failed} item(s) failed to reject`, failedItemIds }
        : { ok: true };
    } catch (err) {
      return {
        error: publicActionError(err, {
          operation: 'reject_visible_suggestions',
          fallback: 'Failed to reject suggestions.',
        }),
      };
    }
  });
}

export async function acceptAllSuggestionAction(input: unknown): Promise<ActionState> {
  return runSentryServerAction('accept_all_suggestion', async () => {
    const parsed = z
      .object({
        suggestionId: uuidSchema,
        itemIds: z.array(uuidSchema).min(1).max(MAX_VISIBLE_ACCEPT_ITEMS).optional(),
      })
      .safeParse(input);
    if (!parsed.success) return { error: 'Invalid suggestion id' };
    const r = await resolveScope();
    if (!r.ok) return { error: r.error };
    try {
      const result = parsed.data.itemIds
        ? await r.scope.suggestions.acceptSelected({
            suggestionId: parsed.data.suggestionId,
            itemIds: parsed.data.itemIds,
          })
        : await r.scope.suggestions.acceptAll(parsed.data.suggestionId);
      if (result.failed === 0) revalidateSuggestionSurfaces();
      return result.failed > 0
        ? { error: `${result.failed} item(s) failed to apply`, failedItemIds: result.failedItemIds }
        : { ok: true };
    } catch (err) {
      return {
        error: publicActionError(err, {
          operation: 'accept_all_suggestions',
          fallback: 'Failed to accept suggestion.',
        }),
      };
    }
  });
}

export async function acceptVisibleSuggestionsAction(input: unknown): Promise<ActionState> {
  return runSentryServerAction('accept_visible_suggestions', async () => {
    const parsed = z
      .object({
        suggestions: z
          .array(
            z.object({
              suggestionId: uuidSchema,
              itemIds: z.array(uuidSchema).min(1).max(MAX_VISIBLE_ACCEPT_ITEMS),
            }),
          )
          .min(1)
          .max(200),
      })
      .refine(
        (data) =>
          data.suggestions.reduce((sum, suggestion) => sum + suggestion.itemIds.length, 0) <=
          MAX_VISIBLE_ACCEPT_ITEMS,
      )
      .safeParse(input);
    if (!parsed.success) return { error: 'Invalid suggestion items' };
    const r = await resolveScope();
    if (!r.ok) return { error: r.error };
    try {
      const results = await parsed.data.suggestions.reduce<
        Promise<{ accepted: number; failed: number; failedItemIds?: string[] }[]>
      >(
        (previousResults, suggestion) =>
          previousResults.then((settledResults) =>
            r.scope.suggestions
              .acceptSelected(suggestion)
              .then((result) => [...settledResults, result]),
          ),
        Promise.resolve([]),
      );
      const failed = results.reduce((sum, result) => sum + result.failed, 0);
      const failedItemIds = [...new Set(results.flatMap((result) => result.failedItemIds ?? []))];
      if (failed === 0) revalidateSuggestionSurfaces();
      return failed > 0
        ? { error: `${failed} item(s) failed to apply`, failedItemIds }
        : { ok: true };
    } catch (err) {
      return {
        error: publicActionError(err, {
          operation: 'accept_visible_suggestions',
          fallback: 'Failed to accept suggestions.',
        }),
      };
    }
  });
}
