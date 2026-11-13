import { IMPERSONATION_COOKIE } from '@timeline/shared/platform-admin';
import { cookies } from 'next/headers';
import { Suspense } from 'react';

import type { ReactNode } from 'react';

import { PlatformAdminNav } from '@/components/platform-admin-nav';
import { requireAdmin } from '@/lib/platform-admin';
export default async function AdminLayout({ children }: { children: ReactNode }) {
  await requireAdmin();
  const hasImpersonation = (await cookies()).has(IMPERSONATION_COOKIE);
  return (
    <main className="dashboard-shell mx-auto max-w-6xl space-y-6 px-4 py-8">
      {hasImpersonation && (
        <form action="/api/platform-admin/exit" method="post">
          <button type="submit" className="min-h-11 rounded-sm border border-border px-3 text-sm">
            Exit impersonation
          </button>
        </form>
      )}
      <Suspense fallback={<nav aria-label="Platform administration" className="min-h-11" />}>
        <PlatformAdminNav />
      </Suspense>
      {children}
    </main>
  );
}
