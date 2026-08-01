import { AuthShell } from '@/components/auth-shell';
import { Skeleton } from '@/components/ui/skeleton';

export default function AcceptInviteLoading() {
  return (
    <AuthShell title="Loading invitation">
      <output className="sr-only" aria-live="polite">
        Loading invitation
      </output>
      <section aria-busy="true" aria-label="Invitation loading placeholder" className="space-y-5">
        <div aria-hidden="true" className="space-y-5">
          <div className="space-y-2">
            <Skeleton className="h-4 w-full motion-reduce:animate-none" />
            <Skeleton className="h-4 w-4/5 motion-reduce:animate-none" />
          </div>
          <div className="flex gap-3">
            <Skeleton className="h-9 w-24 motion-reduce:animate-none" />
            <Skeleton className="h-9 w-20 motion-reduce:animate-none" />
          </div>
        </div>
      </section>
    </AuthShell>
  );
}
