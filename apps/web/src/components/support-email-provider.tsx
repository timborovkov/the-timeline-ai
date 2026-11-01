'use client';

import { createContext, useContext, type ReactNode } from 'react';

import { DEFAULT_SUPPORT_EMAIL } from '@/lib/support-links';

const SupportEmailContext = createContext(DEFAULT_SUPPORT_EMAIL);

export function SupportEmailProvider({ email, children }: { email: string; children: ReactNode }) {
  return <SupportEmailContext.Provider value={email}>{children}</SupportEmailContext.Provider>;
}

export function useSupportEmail(): string {
  return useContext(SupportEmailContext);
}
