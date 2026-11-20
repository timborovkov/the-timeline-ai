import type { DailyDigestPayload } from '#src/messaging/types.js';
import type { TeamScope } from '#src/team-scope.js';

export async function presentSavedViewDigest(
  scope: TeamScope,
  payload: DailyDigestPayload,
  now = new Date(),
): Promise<{ payload: DailyDigestPayload; hasVisibleChanges: boolean }> {
  const { savedViewChanges, ...safe } = payload;
  if (!savedViewChanges?.length) return { payload: safe, hasVisibleChanges: false };
  const changes = await scope.savedViews.visibleDigestChanges(
    savedViewChanges,
    new Date(payload.windowEnd),
    now,
  );
  if (changes.length === 0) {
    return {
      payload: safe.savedViewsOnly ? { ...safe, summary: 'No current saved-view updates.' } : safe,
      hasVisibleChanges: false,
    };
  }
  return {
    payload: {
      ...safe,
      sections: [
        ...(safe.sections ?? []),
        {
          title: 'Saved views',
          items: changes.map(
            ({ title, count }) => `${title} · ${count} new ${count === 1 ? 'match' : 'matches'}`,
          ),
        },
      ],
      links: [...safe.links, { label: 'Saved views', href: '/app/work/views' }],
    },
    hasVisibleChanges: true,
  };
}
