'use client';

import { useLayoutEffect, useRef } from 'react';

/** Event handlers may observe only values from a committed render. */
export function useCommittedRef<T>(value: T) {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}
