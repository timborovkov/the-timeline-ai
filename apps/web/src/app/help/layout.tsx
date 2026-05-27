import type { ReactNode } from 'react';

import { HelpShell } from '@/components/help/help-shell';
import { auth } from '@/lib/auth';

export default async function HelpLayout({ children }: { children: ReactNode }) {
  const session = await auth();
  return <HelpShell isSignedIn={Boolean(session?.user)}>{children}</HelpShell>;
}
