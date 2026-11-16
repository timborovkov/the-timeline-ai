'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';

const ObjectListScrollContext = createContext<HTMLDivElement | null>(null);

export function ObjectListViewport({ children }: { children: ReactNode }) {
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null);
  return (
    <ObjectListScrollContext value={scrollElement}>
      <div ref={setScrollElement} className="min-h-0 flex-1 overflow-y-auto">
        {children}
      </div>
    </ObjectListScrollContext>
  );
}

export function useObjectListScrollElement() {
  return useContext(ObjectListScrollContext);
}
