import { Children, isValidElement } from 'react';

import type { ComponentType, ReactElement, ReactNode } from 'react';

export function findSlot(
  children: ReactNode,
  slot: ComponentType<{ children?: ReactNode }>,
): ReactElement<{ children?: ReactNode }> | undefined {
  return Children.toArray(children).find(
    (child): child is ReactElement<{ children?: ReactNode }> =>
      isValidElement(child) && child.type === slot,
  );
}
