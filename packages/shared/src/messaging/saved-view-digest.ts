import { formatDigestDate } from '#src/messaging/digest-format.js';
import type { DailyDigestPayload } from '#src/messaging/types.js';
import { displayObjectTitle } from '#src/objects/types.js';
import type { TeamScope } from '#src/team-scope.js';

export async function presentSavedViewDigest(
  scope: TeamScope,
  stored: DailyDigestPayload,
  now = new Date(),
): Promise<{ payload: DailyDigestPayload; hasVisibleChanges: boolean }> {
  const { savedViewChanges, evidenceIds, blockerIds, savedViewObservedAt, ...payload } = stored;
  let hasVisibleChanges = false;
  if (evidenceIds?.length) {
    const visible = new Set(
      (await scope.timeline.getEventsByIds(evidenceIds)).map((event) => event.id),
    );
    hasVisibleChanges = evidenceIds.every((id) => visible.has(id));
    if (!hasVisibleChanges) {
      payload.summary =
        'This update’s briefing is unavailable because its sources changed or are no longer accessible.';
      payload.sections = [];
      payload.eventCount = 0;
      delete payload.activity;
      delete payload.momentCount;
      payload.links = [];
    }
  }
  if (blockerIds?.length) {
    const blockers = await scope.objects.listObjects({
      id: blockerIds,
      type: ['task', 'follow_up'],
      status: 'blocked',
      archived: false,
      limit: blockerIds.length,
    });
    if (blockers.length) {
      hasVisibleChanges = true;
      const entries = blockers.map((object) => ({
        label: displayObjectTitle(object),
        href: `/app/objects/${object.id}`,
      }));
      payload.sections = [
        ...(payload.sections ?? []),
        {
          title: 'Still blocked',
          items: entries.map(({ label }) => label),
        },
      ];
      payload.links = [...payload.links, ...entries];
    } else if (!evidenceIds?.length) {
      payload.summary = 'There is no currently visible blocked work in this update.';
    }
  }
  if (!savedViewChanges?.length) return { payload, hasVisibleChanges };
  const changes = await scope.savedViews.visibleDigestChanges(
    savedViewChanges,
    new Date(savedViewObservedAt ?? payload.windowEnd),
    now,
  );
  if (!changes.length) {
    if (payload.savedViewsOnly) payload.summary = 'No current saved-view updates.';
    return { payload, hasVisibleChanges };
  }
  payload.sections = [
    ...(payload.sections ?? []),
    {
      title: 'Saved views',
      items: [
        ...(savedViewObservedAt
          ? [`Matches checked ${formatDigestDate(savedViewObservedAt, payload.timezone)}`]
          : []),
        ...changes.map(
          ({ title, count }) => `${title} · ${count} new ${count === 1 ? 'match' : 'matches'}`,
        ),
      ],
    },
  ];
  payload.links = [...payload.links, ...changes.map(({ title, href }) => ({ label: title, href }))];
  return { payload, hasVisibleChanges: true };
}
