'use client';

import { useEffect } from 'react';

interface DocumentScrollStyles {
  htmlOverflow: string;
  htmlHeight: string;
  bodyOverflow: string;
  bodyHeight: string;
}

let activeLocks = 0;
let previousStyles: DocumentScrollStyles | null = null;

export function AppDocumentScrollLock() {
  useEffect(() => {
    const { documentElement, body } = document;
    if (activeLocks === 0 && previousStyles === null) {
      previousStyles = {
        htmlOverflow: documentElement.style.overflow,
        htmlHeight: documentElement.style.height,
        bodyOverflow: body.style.overflow,
        bodyHeight: body.style.height,
      };
    }

    activeLocks += 1;

    documentElement.style.overflow = 'hidden';
    documentElement.style.height = '100%';
    body.style.overflow = 'hidden';
    body.style.height = '100%';

    return () => {
      activeLocks = Math.max(0, activeLocks - 1);
      if (activeLocks > 0) return;

      queueMicrotask(() => {
        if (activeLocks > 0 || !previousStyles) return;

        documentElement.style.overflow = previousStyles.htmlOverflow;
        documentElement.style.height = previousStyles.htmlHeight;
        body.style.overflow = previousStyles.bodyOverflow;
        body.style.height = previousStyles.bodyHeight;
        previousStyles = null;
      });
    };
  }, []);

  return null;
}
