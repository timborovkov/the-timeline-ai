'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { type ActionState, resolveScope, uuidSchema } from '@/lib/action-scope';
import { runSentryServerAction } from '@/lib/sentry-action';
import { reportCaughtError } from '@/lib/sentry-report';

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
      reportCaughtError(err, { surface: 'server_action', operation: 'accept_suggestion_item' });
      revalidateSuggestionSurfaces();
      return { error: err instanceof Error ? err.message : 'Failed to accept suggestion' };
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
      reportCaughtError(err, { surface: 'server_action', operation: 'reject_suggestion_item' });
      return { error: err instanceof Error ? err.message : 'Failed to reject suggestion' };
    }
  });
}

export async function acceptAllSuggestionAction(input: unknown): Promise<ActionState> {
  return runSentryServerAction('accept_all_suggestion', async () => {
    const parsed = z.object({ suggestionId: uuidSchema }).safeParse(input);
    if (!parsed.success) return { error: 'Invalid suggestion id' };
    const r = await resolveScope();
    if (!r.ok) return { error: r.error };
    try {
      const result = await r.scope.suggestions.acceptAll(parsed.data.suggestionId);
      revalidateSuggestionSurfaces();
      return result.failed > 0
        ? { error: `${result.failed} item(s) failed to apply` }
        : { ok: true };
    } catch (err) {
      reportCaughtError(err, { surface: 'server_action', operation: 'accept_all_suggestions' });
      revalidateSuggestionSurfaces();
      return { error: err instanceof Error ? err.message : 'Failed to accept suggestion' };
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
              itemIds: z.array(uuidSchema).min(1),
            }),
          )
          .min(1)
          .max(200),
      })
      .safeParse(input);
    if (!parsed.success) return { error: 'Invalid suggestion items' };
    const r = await resolveScope();
    if (!r.ok) return { error: r.error };
    try {
      const results = await parsed.data.suggestions.reduce<
        Promise<{ accepted: number; failed: number }[]>
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
      revalidateSuggestionSurfaces();
      return failed > 0 ? { error: `${failed} item(s) failed to apply` } : { ok: true };
    } catch (err) {
      reportCaughtError(err, { surface: 'server_action', operation: 'accept_visible_suggestions' });
      revalidateSuggestionSurfaces();
      return { error: err instanceof Error ? err.message : 'Failed to accept suggestions' };
    }
  });
}
