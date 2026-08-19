import { PinButton } from '@/components/pins/pin-button';

export function ObjectPinButton({
  objectId,
  initialPinned,
}: {
  objectId: string;
  initialPinned: boolean;
}) {
  return <PinButton target={{ kind: 'object', key: objectId }} initialPinned={initialPinned} />;
}
