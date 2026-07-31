import { AuthShell } from '@/components/auth-shell';
import { Skeleton } from '@/components/ui/skeleton';

export default function AcceptInviteLoading() {
  return (
    <AuthShell title="Loading invitation">
      <output className="sr-only">Loading invitation</output>
      <section aria-busy="true" aria-label="Invitation loading placeholder" className="space-y-5">
        <div className="space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-4/5" />
        </div>
        <div className="flex gap-3">
          <Skeleton className="h-9 w-24" />
          <Skeleton className="h-9 w-20" />
        </div>
      </section>
    </AuthShell>
  );
}
