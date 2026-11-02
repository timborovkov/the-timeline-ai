import type { ReactNode } from 'react';

import { HelpShell } from '@/components/help/help-shell';

export default function HelpLayout({ children }: { children: ReactNode }) {
  return <HelpShell>{children}</HelpShell>;
}
