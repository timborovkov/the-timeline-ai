'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { type ActionState, resolveScope, uuidSchema } from '@/lib/action-scope';

function revalidateSuggestionSurfaces() {
  revalidatePath('/app/approvals');
  revalidatePath('/app/timeline');
  revalidatePath('/app/objects', 'layout');
  revalidatePath('/app/calendar');
  revalidatePath('/app/tasks');
  revalidatePath('/app/inbox');
}

export async function acceptSuggestionItemAction(input: unknown): Promise<ActionState> {
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
    revalidateSuggestionSurfaces();
    return { error: err instanceof Error ? err.message : 'Failed to accept suggestion' };
  }
}

export async function rejectSuggestionItemAction(input: unknown): Promise<ActionState> {
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
    return { error: err instanceof Error ? err.message : 'Failed to reject suggestion' };
  }
}

export async function acceptAllSuggestionAction(input: unknown): Promise<ActionState> {
  const parsed = z.object({ suggestionId: uuidSchema }).safeParse(input);
  if (!parsed.success) return { error: 'Invalid suggestion id' };
  const r = await resolveScope();
  if (!r.ok) return { error: r.error };
  try {
    const result = await r.scope.suggestions.acceptAll(parsed.data.suggestionId);
    revalidateSuggestionSurfaces();
    return result.failed > 0 ? { error: `${result.failed} item(s) failed to apply` } : { ok: true };
  } catch (err) {
    revalidateSuggestionSurfaces();
    return { error: err instanceof Error ? err.message : 'Failed to accept suggestion' };
  }
}
