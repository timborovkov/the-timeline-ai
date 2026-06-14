import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  acceptAllSuggestionAction,
  acceptSuggestionItemAction,
  acceptVisibleSuggestionsAction,
  rejectSuggestionItemAction,
} from '@/app/actions/suggestions';

/**
 * Server-action tests for approval-queue suggestions. The shared suggestion
 * scope owns durable DB behavior; these tests pin validation, auth/scope
 * failures, action-to-scope calls, revalidation, and bounded error messages.
 */

const fakes = vi.hoisted(() => ({
  fakeResolveScope: vi.fn(),
  fakeRevalidatePath: vi.fn(),
  fakeSuggestions: {
    acceptSuggestionItem: vi.fn(),
    rejectSuggestionItem: vi.fn(),
    acceptAll: vi.fn(),
    acceptSelected: vi.fn(),
  },
}));

vi.mock('@/lib/action-scope', async () => {
  const { z } = await import('zod');
  return {
    resolveScope: fakes.fakeResolveScope,
    uuidSchema: z.uuid(),
  };
});
vi.mock('next/cache', () => ({ revalidatePath: fakes.fakeRevalidatePath }));

const ITEM_ID = '11111111-1111-4111-8111-111111111111';
const SUGGESTION_ID = '22222222-2222-4222-8222-222222222222';

const SURFACES = [
  ['/app/approvals'],
  ['/app/timeline'],
  ['/app/objects', 'layout'],
  ['/app/calendar'],
  ['/app/tasks'],
  ['/app/inbox'],
] as const;

beforeEach(() => {
  vi.clearAllMocks();
  fakes.fakeResolveScope.mockResolvedValue({
    ok: true,
    scope: { suggestions: fakes.fakeSuggestions },
    userId: '33333333-3333-4333-8333-333333333333',
  });
  fakes.fakeSuggestions.acceptSuggestionItem.mockResolvedValue(true);
  fakes.fakeSuggestions.rejectSuggestionItem.mockResolvedValue(true);
  fakes.fakeSuggestions.acceptAll.mockResolvedValue({ accepted: 2, failed: 0 });
  fakes.fakeSuggestions.acceptSelected.mockResolvedValue({ accepted: 2, failed: 0 });
});

function expectSuggestionSurfacesRevalidated() {
  for (const args of SURFACES) {
    expect(fakes.fakeRevalidatePath).toHaveBeenCalledWith(...args);
  }
}

describe('suggestion action validation and scope', () => {
  it('rejects malformed ids before resolving scope', async () => {
    await expect(acceptSuggestionItemAction({ itemId: 'bad' })).resolves.toEqual({
      error: 'Invalid suggestion item id',
    });
    await expect(rejectSuggestionItemAction({ itemId: 'bad' })).resolves.toEqual({
      error: 'Invalid suggestion item id',
    });
    await expect(acceptAllSuggestionAction({ suggestionId: 'bad' })).resolves.toEqual({
      error: 'Invalid suggestion id',
    });
    await expect(
      acceptVisibleSuggestionsAction({
        suggestions: [{ suggestionId: SUGGESTION_ID, itemIds: ['bad'] }],
      }),
    ).resolves.toEqual({
      error: 'Invalid suggestion items',
    });

    expect(fakes.fakeResolveScope).not.toHaveBeenCalled();
  });

  it('returns scope errors without touching the suggestion scope', async () => {
    fakes.fakeResolveScope.mockResolvedValue({ ok: false, error: 'No active team' });

    await expect(acceptSuggestionItemAction({ itemId: ITEM_ID })).resolves.toEqual({
      error: 'No active team',
    });

    expect(fakes.fakeSuggestions.acceptSuggestionItem).not.toHaveBeenCalled();
    expect(fakes.fakeRevalidatePath).not.toHaveBeenCalled();
  });
});

describe('suggestion item actions', () => {
  it('accepts an item and revalidates every approval-dependent surface', async () => {
    await expect(acceptSuggestionItemAction({ itemId: ITEM_ID })).resolves.toEqual({ ok: true });

    expect(fakes.fakeSuggestions.acceptSuggestionItem).toHaveBeenCalledWith(ITEM_ID);
    expectSuggestionSurfacesRevalidated();
  });

  it('rejects an item and revalidates every approval-dependent surface', async () => {
    await expect(rejectSuggestionItemAction({ itemId: ITEM_ID })).resolves.toEqual({ ok: true });

    expect(fakes.fakeSuggestions.rejectSuggestionItem).toHaveBeenCalledWith(ITEM_ID);
    expectSuggestionSurfacesRevalidated();
  });

  it('returns no-longer-pending errors for already resolved items', async () => {
    fakes.fakeSuggestions.acceptSuggestionItem.mockResolvedValue(false);
    fakes.fakeSuggestions.rejectSuggestionItem.mockResolvedValue(false);

    await expect(acceptSuggestionItemAction({ itemId: ITEM_ID })).resolves.toEqual({
      error: 'Suggestion item no longer pending',
    });
    await expect(rejectSuggestionItemAction({ itemId: ITEM_ID })).resolves.toEqual({
      error: 'Suggestion item no longer pending',
    });
  });

  it('maps accept failures and refreshes stale approval surfaces', async () => {
    fakes.fakeSuggestions.acceptSuggestionItem.mockRejectedValue(new Error('apply failed'));

    await expect(acceptSuggestionItemAction({ itemId: ITEM_ID })).resolves.toEqual({
      error: 'apply failed',
    });
    expectSuggestionSurfacesRevalidated();
  });

  it('maps reject failures without claiming success', async () => {
    fakes.fakeSuggestions.rejectSuggestionItem.mockRejectedValue(new Error('reject failed'));

    await expect(rejectSuggestionItemAction({ itemId: ITEM_ID })).resolves.toEqual({
      error: 'reject failed',
    });
  });
});

describe('accept-all suggestion action', () => {
  it('accepts all items and revalidates every approval-dependent surface', async () => {
    await expect(acceptAllSuggestionAction({ suggestionId: SUGGESTION_ID })).resolves.toEqual({
      ok: true,
    });

    expect(fakes.fakeSuggestions.acceptAll).toHaveBeenCalledWith(SUGGESTION_ID);
    expectSuggestionSurfacesRevalidated();
  });

  it('surfaces partial failure count after revalidation', async () => {
    fakes.fakeSuggestions.acceptAll.mockResolvedValue({ accepted: 1, failed: 2 });

    await expect(acceptAllSuggestionAction({ suggestionId: SUGGESTION_ID })).resolves.toEqual({
      error: '2 item(s) failed to apply',
    });
    expectSuggestionSurfacesRevalidated();
  });

  it('maps accept-all failures and refreshes stale approval surfaces', async () => {
    fakes.fakeSuggestions.acceptAll.mockRejectedValue(new Error('bundle failed'));

    await expect(acceptAllSuggestionAction({ suggestionId: SUGGESTION_ID })).resolves.toEqual({
      error: 'bundle failed',
    });
    expectSuggestionSurfacesRevalidated();
  });
});

describe('accept-visible suggestions action', () => {
  it('accepts visible suggestion groups and revalidates every approval-dependent surface', async () => {
    const secondItemId = '44444444-4444-4444-8444-444444444444';

    await expect(
      acceptVisibleSuggestionsAction({
        suggestions: [{ suggestionId: SUGGESTION_ID, itemIds: [ITEM_ID, secondItemId] }],
      }),
    ).resolves.toEqual({ ok: true });

    expect(fakes.fakeSuggestions.acceptSelected).toHaveBeenCalledWith({
      suggestionId: SUGGESTION_ID,
      itemIds: [ITEM_ID, secondItemId],
    });
    expect(fakes.fakeSuggestions.acceptSuggestionItem).not.toHaveBeenCalled();
    expect(fakes.fakeSuggestions.acceptAll).not.toHaveBeenCalled();
    expectSuggestionSurfacesRevalidated();
  });

  it('surfaces total partial failure count after revalidation', async () => {
    fakes.fakeSuggestions.acceptSelected
      .mockResolvedValueOnce({ accepted: 1, failed: 1 })
      .mockResolvedValueOnce({ accepted: 0, failed: 1 });

    await expect(
      acceptVisibleSuggestionsAction({
        suggestions: [
          {
            suggestionId: SUGGESTION_ID,
            itemIds: [ITEM_ID, '44444444-4444-4444-8444-444444444444'],
          },
          {
            suggestionId: '55555555-5555-4555-8555-555555555555',
            itemIds: ['66666666-6666-4666-8666-666666666666'],
          },
        ],
      }),
    ).resolves.toEqual({
      error: '2 item(s) failed to apply',
    });
    expectSuggestionSurfacesRevalidated();
  });

  it('accepts visible suggestion groups in order before revalidating', async () => {
    const secondSuggestionId = '55555555-5555-4555-8555-555555555555';
    let resolveFirst!: (result: { accepted: number; failed: number }) => void;
    const firstAcceptance = new Promise<{ accepted: number; failed: number }>((resolve) => {
      resolveFirst = resolve;
    });
    fakes.fakeSuggestions.acceptSelected
      .mockReturnValueOnce(firstAcceptance)
      .mockResolvedValueOnce({ accepted: 1, failed: 0 });

    const action = acceptVisibleSuggestionsAction({
      suggestions: [
        { suggestionId: SUGGESTION_ID, itemIds: [ITEM_ID] },
        {
          suggestionId: secondSuggestionId,
          itemIds: ['66666666-6666-4666-8666-666666666666'],
        },
      ],
    });

    await vi.waitFor(() => {
      expect(fakes.fakeSuggestions.acceptSelected).toHaveBeenCalledTimes(1);
    });
    expect(fakes.fakeRevalidatePath).not.toHaveBeenCalled();

    resolveFirst({ accepted: 1, failed: 0 });
    await expect(action).resolves.toEqual({ ok: true });

    expect(fakes.fakeSuggestions.acceptSelected).toHaveBeenNthCalledWith(2, {
      suggestionId: secondSuggestionId,
      itemIds: ['66666666-6666-4666-8666-666666666666'],
    });
    expectSuggestionSurfacesRevalidated();
  });
});
