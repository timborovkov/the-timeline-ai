import {
  Activity,
  BriefcaseBusiness,
  CalendarDays,
  CircleDot,
  FileText,
  KanbanSquare,
  Mic,
  Pin,
  UserRound,
  UsersRound,
} from 'lucide-react';

import type { PinnedItem } from '@timeline/shared/pins';

export function PinTargetIcon({
  kind,
  className,
}: {
  kind: PinnedItem['iconKind'];
  className?: string;
}) {
  const Icon =
    kind === 'board'
      ? KanbanSquare
      : kind === 'document'
        ? FileText
        : kind === 'meeting' || kind === 'saved_meeting'
          ? Mic
          : kind === 'calendar_event'
            ? CalendarDays
            : kind === 'person'
              ? UserRound
              : kind === 'company'
                ? UsersRound
                : kind === 'deal' || kind === 'vendor'
                  ? BriefcaseBusiness
                  : kind.startsWith('timeline_')
                    ? Activity
                    : kind === 'task' || kind === 'follow_up'
                      ? CircleDot
                      : Pin;
  return <Icon aria-hidden="true" className={className} />;
}
