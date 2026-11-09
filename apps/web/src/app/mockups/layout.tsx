import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: {
    default: 'Mockups',
    template: '%s · Mockups · The Timeline',
  },
  description: 'Clickable visual mockups. Example data only. Not a product route.',
  robots: { index: false, follow: false },
};

export default function MockupsLayout({ children }: { children: ReactNode }) {
  return children;
}
