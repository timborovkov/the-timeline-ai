import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';

const SLOT_NAME = Symbol('collectionSlotName');

type CollectionSlotProps = {
  children?: ReactNode;
  title?: string;
};

type CollectionSlotComponent = ((props: CollectionSlotProps) => ReactElement | null) & {
  [SLOT_NAME]: string;
};

export function createCollectionSlot(name: string): CollectionSlotComponent {
  function CollectionSlot({ children }: CollectionSlotProps) {
    return (children as ReactElement | null | undefined) ?? null;
  }
  CollectionSlot.displayName = `CollectionSlot(${name})`;
  const slot = CollectionSlot as unknown as CollectionSlotComponent;
  slot[SLOT_NAME] = name;
  return slot;
}

export function readCollectionSlots(
  children: ReactNode,
  slotTypes: Record<string, CollectionSlotComponent>,
): Record<string, ReactNode> {
  const typeToKey = new Map<unknown, string>();
  for (const [key, type] of Object.entries(slotTypes)) {
    typeToKey.set(type, key);
  }
  const result: Record<string, ReactNode> = {};
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    const key = typeToKey.get(child.type);
    if (!key) return;
    result[key] = (child.props as { children?: ReactNode }).children;
  });
  return result;
}
