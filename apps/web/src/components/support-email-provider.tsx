'use client';

import { createContext, useContext, type ReactNode } from 'react';

import { usePublicRuntime } from '@/lib/public-runtime';
import { DEFAULT_SUPPORT_EMAIL } from '@/lib/support-links';

const SupportEmailContext = createContext(DEFAULT_SUPPORT_EMAIL);

export function SupportEmailProvider({ email, children }: { email?: string; children: ReactNode }) {
  const runtime = usePublicRuntime(email === undefined);
  const value =
    email ?? (runtime.status === 'ready' ? runtime.supportEmail : DEFAULT_SUPPORT_EMAIL);
  return <SupportEmailContext.Provider value={value}>{children}</SupportEmailContext.Provider>;
}

export function useSupportEmail(): string {
  return useContext(SupportEmailContext);
}

export function SupportMailto({
  className,
  subject,
  prefix,
  children,
}: {
  className?: string;
  subject?: string;
  prefix?: string;
  children?: ReactNode;
}) {
  const email = useSupportEmail();
  const href = subject
    ? `mailto:${email}?subject=${encodeURIComponent(subject)}`
    : `mailto:${email}`;
  return (
    <a href={href} className={className}>
      {children ?? (prefix ? `${prefix}${email}` : email)}
    </a>
  );
}
