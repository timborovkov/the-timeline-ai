import { IMPERSONATION_COOKIE } from '@timeline/shared/platform-admin';
import { cookies } from 'next/headers';
import Link from 'next/link';

import type { ReactNode } from 'react';

import { requireAdmin } from '@/lib/platform-admin';
export default async function AdminLayout({ children }: { children: ReactNode }) {
  await requireAdmin();
  const hasImpersonation = (await cookies()).has(IMPERSONATION_COOKIE);
  return (
    <main className="mx-auto max-w-6xl space-y-6 px-4 py-8">
      {hasImpersonation && (
        <form action="/api/platform-admin/exit" method="post">
          <button type="submit" className="min-h-11 rounded-sm border border-border px-3 text-sm">
            Exit impersonation
          </button>
        </form>
      )}
      <nav
        aria-label="Platform administration"
        className="flex flex-wrap gap-4 border-b border-border pb-3 text-sm"
      >
        <Link href="/app/admin/users">Users</Link>
        <Link href="/app/admin/teams">Teams</Link>
        <Link href="/app/admin/teams?status=requested">Deletion requests</Link>
        <Link href="/app/admin/audit">Audit</Link>
        <Link href="/app/admin/billing">Billing</Link>
        <Link href="/app">Back to workspace</Link>
      </nav>
      {children}
    </main>
  );
}
