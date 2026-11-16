import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Set up your team',
  description: 'Bring something real and start a cited work record.',
};

export default function OnboardingLayout({ children }: { children: ReactNode }) {
  return children;
}
