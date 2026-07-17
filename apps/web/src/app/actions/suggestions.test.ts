import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import {
  acceptAllSuggestionAction,
  acceptSuggestionItemAction,
  acceptVisibleSuggestionsAction,
  rejectSuggestionItemAction,
  rejectVisibleSuggestionsAction,
} from '@/app/actions/suggestions';

/**
 * Server-action tests for approval-queue suggestions. The shared suggestion
 * scope owns durable DB behavior; these tests pin validation, auth/scope
 * failures, action-to-scope calls, revalidation, and bounded error messages.
 */

const fakes = vi.hoisted(() => ({
  fakeResolveScope: vi.fn(),
  fakeRevalidatePath: vi.fn(),
  fakeReportCaughtError: vi.fn(),
  fakeSuggestions: {
    acceptSuggestionItem: vi.fn(),
    rejectSuggestionItem: vi.fn(),
    acceptAll: vi.fn(),
    acceptSelected: vi.fn(),
    listSuggestions: vi.fn(),
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
vi.mock('@/lib/sentry-report', () => ({ reportCaughtError: fakes.fakeReportCaughtError }));

const ITEM_ID = '11111111-1111-4111-8111-111111111111';
const SUGGESTION_ID = '22222222-2222-4222-8222-222222222222';

const SURFACES = [
  ['/app', 'layout'],
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
  fakes.fakeSuggestions.listSuggestions.mockResolvedValue([
    { items: [{ id: ITEM_ID, status: 'failed' }] },
  ]);
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
    await expect(
      acceptVisibleSuggestionsAction({
        suggestions: [
          {
            suggestionId: SUGGESTION_ID,
            itemIds: Array.from(
              { length: 501 },
              (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
            ),
          },
        ],
      }),
    ).resolves.toEqual({
      error: 'Invalid suggestion items',
    });
    await expect(
      rejectVisibleSuggestionsAction({
        suggestions: [{ suggestionId: SUGGESTION_ID, itemIds: ['bad'] }],
      }),
    ).resolves.toEqual({
      error: 'Invalid suggestion items',
    });
    await expect(
      rejectVisibleSuggestionsAction({
        suggestions: [
          {
            suggestionId: SUGGESTION_ID,
            itemIds: Array.from(
              { length: 501 },
              (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
            ),
          },
        ],
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

  it('identifies accept failures so clients can move the row to Failed', async () => {
    fakes.fakeSuggestions.acceptSuggestionItem.mockRejectedValue(new Error('apply failed'));

    const result = await acceptSuggestionItemAction({ itemId: ITEM_ID });
    expect(result.error).toMatch(/^Failed to accept suggestion\. Reference: [0-9a-f]{8}\.$/);
    expect(result.error).not.toContain('apply failed');
    expect(result.failedItemIds).toEqual([ITEM_ID]);
    expect(fakes.fakeReportCaughtError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        surface: 'server_action',
        operation: 'accept_suggestion_item',
      }),
    );
    expectSuggestionSurfacesRevalidated();
  });

  it('keeps a row visible when accept fails before the item transitions to Failed', async () => {
    fakes.fakeSuggestions.acceptSuggestionItem.mockRejectedValue(new Error('database unavailable'));
    fakes.fakeSuggestions.listSuggestions.mockResolvedValue([]);

    const result = await acceptSuggestionItemAction({ itemId: ITEM_ID });

    expect(result.error).toMatch(/^Failed to accept suggestion\. Reference: [0-9a-f]{8}\.$/);
    expect(result.failedItemIds).toBeUndefined();
    expectSuggestionSurfacesRevalidated();
  });

  it('does not report expected persisted apply failures to Sentry', async () => {
    const err = Object.assign(new Error('Invalid proposal payload'), {
      name: 'ExpectedSuggestionApplyFailure',
      code: 'TIMELINE_EXPECTED_SUGGESTION_APPLY_FAILURE',
    });
    fakes.fakeSuggestions.acceptSuggestionItem.mockRejectedValue(err);

    await expect(acceptSuggestionItemAction({ itemId: ITEM_ID })).resolves.toEqual({
      error: err.message,
      failedItemIds: [ITEM_ID],
    });
    expect(fakes.fakeReportCaughtError).not.toHaveBeenCalled();
    expectSuggestionSurfacesRevalidated();
  });

  it('reports raw invalid proposal payload failures that were not marked expected', async () => {
    const err = new z.ZodError([
      {
        code: 'invalid_type',
        expected: 'string',
        input: undefined,
        path: ['startAt'],
        message: 'Invalid input: expected string, received undefined',
      },
    ]);
    fakes.fakeSuggestions.acceptSuggestionItem.mockRejectedValue(err);

    const result = await acceptSuggestionItemAction({ itemId: ITEM_ID });
    expect(result.error).toMatch(/^Failed to accept suggestion\. Reference: [0-9a-f]{8}\.$/);
    expect(result.error).not.toContain('startAt');
    expect(result.failedItemIds).toEqual([ITEM_ID]);
    expect(fakes.fakeReportCaughtError).toHaveBeenCalledWith(
      err,
      expect.objectContaining({ operation: 'accept_suggestion_item' }),
    );
    expectSuggestionSurfacesRevalidated();
  });

  it('reports duplicate-key failures that were not marked expected', async () => {
    const err = Object.assign(new Error('duplicate key value violates unique constraint'), {
      code: '23505',
    });
    fakes.fakeSuggestions.acceptSuggestionItem.mockRejectedValue(err);

    const result = await acceptSuggestionItemAction({ itemId: ITEM_ID });
    expect(result.error).toMatch(/^Failed to accept suggestion\. Reference: [0-9a-f]{8}\.$/);
    expect(result.error).not.toContain('duplicate key');
    expect(result.failedItemIds).toEqual([ITEM_ID]);
    expect(fakes.fakeReportCaughtError).toHaveBeenCalledWith(
      err,
      expect.objectContaining({ operation: 'accept_suggestion_item' }),
    );
    expectSuggestionSurfacesRevalidated();
  });

  it('maps reject failures without claiming success', async () => {
    fakes.fakeSuggestions.rejectSuggestionItem.mockRejectedValue(new Error('reject failed'));

    const result = await rejectSuggestionItemAction({ itemId: ITEM_ID });
    expect(result.error).toMatch(/^Failed to reject suggestion\. Reference: [0-9a-f]{8}\.$/);
    expect(result.error).not.toContain('reject failed');
    expectSuggestionSurfacesRevalidated();
  });
});

describe('accept-all suggestion action', () => {
  it('accepts all items and revalidates every approval-dependent surface', async () => {
    await expect(acceptAllSuggestionAction({ suggestionId: SUGGESTION_ID })).resolves.toEqual({
      ok: true,
    });

    expect(fakes.fakeSuggestions.acceptAll).toHaveBeenCalledWith(SUGGESTION_ID);
    expect(fakes.fakeSuggestions.acceptSelected).not.toHaveBeenCalled();
    expectSuggestionSurfacesRevalidated();
  });

  it('accepts bundle items through the item-scoped bulk path when ids are provided', async () => {
    const secondItemId = '44444444-4444-4444-8444-444444444444';
    fakes.fakeSuggestions.acceptSelected.mockResolvedValue({
      accepted: 1,
      failed: 1,
      failedItemIds: [secondItemId],
    });

    await expect(
      acceptAllSuggestionAction({
        suggestionId: SUGGESTION_ID,
        itemIds: [ITEM_ID, secondItemId],
      }),
    ).resolves.toEqual({
      error: '1 item(s) failed to apply',
      failedItemIds: [secondItemId],
    });

    expect(fakes.fakeSuggestions.acceptSelected).toHaveBeenCalledWith({
      suggestionId: SUGGESTION_ID,
      itemIds: [ITEM_ID, secondItemId],
    });
    expect(fakes.fakeSuggestions.acceptAll).not.toHaveBeenCalled();
    expectSuggestionSurfacesRevalidated();
  });

  it('surfaces partial failure count and revalidates count-bearing surfaces', async () => {
    fakes.fakeSuggestions.acceptAll.mockResolvedValue({
      accepted: 1,
      failed: 2,
      failedItemIds: [ITEM_ID, '44444444-4444-4444-8444-444444444444'],
    });

    await expect(acceptAllSuggestionAction({ suggestionId: SUGGESTION_ID })).resolves.toEqual({
      error: '2 item(s) failed to apply',
      failedItemIds: [ITEM_ID, '44444444-4444-4444-8444-444444444444'],
    });
    expectSuggestionSurfacesRevalidated();
  });

  it('maps accept-all failures and revalidates potentially changed state', async () => {
    fakes.fakeSuggestions.acceptAll.mockRejectedValue(new Error('bundle failed'));

    const result = await acceptAllSuggestionAction({ suggestionId: SUGGESTION_ID });
    expect(result.error).toMatch(/^Failed to accept suggestion\. Reference: [0-9a-f]{8}\.$/);
    expect(result.error).not.toContain('bundle failed');
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

  it('surfaces total partial failure count and revalidates count-bearing surfaces', async () => {
    fakes.fakeSuggestions.acceptSelected
      .mockResolvedValueOnce({
        accepted: 1,
        failed: 1,
        failedItemIds: ['44444444-4444-4444-8444-444444444444'],
      })
      .mockResolvedValueOnce({
        accepted: 0,
        failed: 1,
        failedItemIds: ['66666666-6666-4666-8666-666666666666'],
      });

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
      failedItemIds: [
        '44444444-4444-4444-8444-444444444444',
        '66666666-6666-4666-8666-666666666666',
      ],
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

describe('reject-visible suggestions action', () => {
  it('rejects visible suggestion groups and revalidates every approval-dependent surface', async () => {
    const secondItemId = '44444444-4444-4444-8444-444444444444';

    await expect(
      rejectVisibleSuggestionsAction({
        suggestions: [{ suggestionId: SUGGESTION_ID, itemIds: [ITEM_ID, secondItemId] }],
      }),
    ).resolves.toEqual({ ok: true });

    expect(fakes.fakeSuggestions.rejectSuggestionItem).toHaveBeenCalledWith(ITEM_ID);
    expect(fakes.fakeSuggestions.rejectSuggestionItem).toHaveBeenCalledWith(secondItemId);
    expect(fakes.fakeSuggestions.acceptSuggestionItem).not.toHaveBeenCalled();
    expect(fakes.fakeSuggestions.acceptAll).not.toHaveBeenCalled();
    expect(fakes.fakeSuggestions.acceptSelected).not.toHaveBeenCalled();
    expectSuggestionSurfacesRevalidated();
  });

  it('surfaces total reject failures and revalidates count-bearing surfaces', async () => {
    fakes.fakeSuggestions.rejectSuggestionItem.mockResolvedValueOnce(true).mockResolvedValue(false);

    await expect(
      rejectVisibleSuggestionsAction({
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
      error: '2 item(s) failed to reject',
      failedItemIds: [
        '44444444-4444-4444-8444-444444444444',
        '66666666-6666-4666-8666-666666666666',
      ],
    });
    expectSuggestionSurfacesRevalidated();
  });

  it('rejects visible items in order before revalidating', async () => {
    const secondItemId = '44444444-4444-4444-8444-444444444444';
    let resolveFirst!: (result: boolean) => void;
    const firstRejection = new Promise<boolean>((resolve) => {
      resolveFirst = resolve;
    });
    fakes.fakeSuggestions.rejectSuggestionItem
      .mockReturnValueOnce(firstRejection)
      .mockResolvedValueOnce(true);

    const action = rejectVisibleSuggestionsAction({
      suggestions: [{ suggestionId: SUGGESTION_ID, itemIds: [ITEM_ID, secondItemId] }],
    });

    await vi.waitFor(() => {
      expect(fakes.fakeSuggestions.rejectSuggestionItem).toHaveBeenCalledTimes(1);
    });
    expect(fakes.fakeRevalidatePath).not.toHaveBeenCalled();

    resolveFirst(true);
    await expect(action).resolves.toEqual({ ok: true });

    expect(fakes.fakeSuggestions.rejectSuggestionItem).toHaveBeenNthCalledWith(2, secondItemId);
    expectSuggestionSurfacesRevalidated();
  });

  it('maps reject-visible failures and revalidates potentially changed state', async () => {
    fakes.fakeSuggestions.rejectSuggestionItem.mockRejectedValue(new Error('reject failed'));

    const result = await rejectVisibleSuggestionsAction({
      suggestions: [{ suggestionId: SUGGESTION_ID, itemIds: [ITEM_ID] }],
    });
    expect(result.error).toMatch(/^Failed to reject suggestions\. Reference: [0-9a-f]{8}\.$/);
    expect(result.error).not.toContain('reject failed');
    expect(fakes.fakeReportCaughtError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ operation: 'reject_visible_suggestions' }),
    );
    expectSuggestionSurfacesRevalidated();
  });
});
