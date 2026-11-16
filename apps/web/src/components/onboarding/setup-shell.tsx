import type { ReactNode } from 'react';

import { Wordmark } from '@/components/brand/logo';
import { ThemeToggle } from '@/components/theme-toggle';

export function SetupShell({ progress, children }: { progress: string; children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-bg text-fg">
      <header className="flex h-12 items-center justify-between border-b border-border px-4">
        <Wordmark className="text-fg" />
        <div className="flex items-center gap-3">
          <span className="text-xs text-fg-dim">{progress}</span>
          <ThemeToggle className="text-fg-muted hover:text-fg" />
        </div>
      </header>
      <main className="flex flex-1 justify-center px-4 py-6 md:px-6 md:py-10">
        <div className="w-full max-w-[720px]">{children}</div>
      </main>
    </div>
  );
}
