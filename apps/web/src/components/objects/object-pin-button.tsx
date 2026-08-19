import { PinButton } from '@/components/pins/pin-button';

export function ObjectPinButton({
  objectId,
  initialPinned,
  compact = false,
  icon = false,
}: {
  objectId: string;
  initialPinned: boolean;
  compact?: boolean;
  icon?: boolean;
}) {
  return (
    <PinButton
      target={{ kind: 'object', key: objectId }}
      initialPinned={initialPinned}
      compact={compact}
      icon={icon}
    />
  );
}
