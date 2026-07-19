'use client';

import { createContext, use } from 'react';

import type { ReactNode } from 'react';

import { DEFAULT_TIMEZONE } from '@/lib/timezones';

const WorkspaceTimezoneContext = createContext(DEFAULT_TIMEZONE);

export function WorkspaceTimezoneProvider({
  children,
  timezone,
}: {
  children: ReactNode;
  timezone: string;
}) {
  return (
    <WorkspaceTimezoneContext.Provider value={timezone}>
      {children}
    </WorkspaceTimezoneContext.Provider>
  );
}

export function useWorkspaceTimezone(): string {
  return use(WorkspaceTimezoneContext);
}
