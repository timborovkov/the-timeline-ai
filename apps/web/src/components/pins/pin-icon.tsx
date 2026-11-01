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
  const Icon = pinIcon(kind);
  return <Icon aria-hidden="true" className={className} />;
}

function pinIcon(kind: PinnedItem['iconKind']) {
  switch (kind) {
    case 'board':
      return KanbanSquare;
    case 'document':
      return FileText;
    case 'meeting':
    case 'saved_meeting':
      return Mic;
    case 'calendar_event':
      return CalendarDays;
    case 'person':
      return UserRound;
    case 'company':
      return UsersRound;
    case 'deal':
    case 'vendor':
      return BriefcaseBusiness;
    case 'task':
    case 'follow_up':
      return CircleDot;
    default:
      return kind.startsWith('timeline_') ? Activity : Pin;
  }
}
