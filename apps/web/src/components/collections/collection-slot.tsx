import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';

const SLOT_NAME = Symbol('collectionSlotName');
const COLLECTION_SLOT_ATTR = 'data-collection-slot';

interface CollectionSlotProps {
  children?: ReactNode;
  title?: string;
}

type CollectionSlotComponent = ((props: CollectionSlotProps) => ReactElement | null) & {
  [SLOT_NAME]: string;
};

export function createCollectionSlot(name: string): CollectionSlotComponent {
  function CollectionSlot({ children, title }: CollectionSlotProps) {
    return (
      <div className="contents" data-collection-slot={name} title={title}>
        {children}
      </div>
    );
  }
  CollectionSlot.displayName = `CollectionSlot(${name})`;
  const slot = CollectionSlot as unknown as CollectionSlotComponent;
  slot[SLOT_NAME] = name;
  return slot;
}

function slotNameFromChild(
  child: ReactElement<{ children?: ReactNode }>,
  typeToKey: Map<unknown, string>,
  slotTypes: Record<string, CollectionSlotComponent>,
): string | undefined {
  const fromType = typeToKey.get(child.type);
  if (fromType) return fromType;
  const props = child.props as { [COLLECTION_SLOT_ATTR]?: unknown };
  const fromAttr = props[COLLECTION_SLOT_ATTR];
  return typeof fromAttr === 'string' && fromAttr in slotTypes ? fromAttr : undefined;
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
    const key = slotNameFromChild(
      child as ReactElement<{ children?: ReactNode }>,
      typeToKey,
      slotTypes,
    );
    if (!key) return;
    result[key] = (child.props as { children?: ReactNode }).children;
  });
  return result;
}
