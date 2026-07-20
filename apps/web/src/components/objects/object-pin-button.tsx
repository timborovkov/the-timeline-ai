import { PinButton } from '@/components/pins/pin-button';

export function ObjectPinButton({
  objectId,
  initialPinned,
  compact = false,
}: {
  objectId: string;
  initialPinned: boolean;
  compact?: boolean;
}) {
  return (
    <PinButton
      target={{ kind: 'object', key: objectId }}
      initialPinned={initialPinned}
      compact={compact}
    />
  );
}
