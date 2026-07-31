import { AuthShell } from '@/components/auth-shell';
import { Skeleton } from '@/components/ui/skeleton';

export default function LegalAcceptanceLoading() {
  return (
    <AuthShell
      maxWidth="lg"
      title="Review The Timeline terms"
      subtitle="Before entering the signed-in product, accept the current Terms of Use and acknowledge the Privacy Policy."
    >
      <output className="sr-only" aria-live="polite">
        Loading legal acceptance
      </output>
      <section
        aria-busy="true"
        aria-label="Legal acceptance loading placeholder"
        className="space-y-5"
      >
        <div aria-hidden="true" className="space-y-5">
          <div className="rounded-sm border border-border bg-surface p-4">
            <Skeleton className="h-4 w-full motion-reduce:animate-none" />
            <Skeleton className="mt-2 h-4 w-4/5 motion-reduce:animate-none" />
          </div>
          <div className="flex items-start gap-3">
            <Skeleton className="mt-1 size-4 shrink-0 motion-reduce:animate-none" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-full motion-reduce:animate-none" />
              <Skeleton className="h-4 w-3/4 motion-reduce:animate-none" />
            </div>
          </div>
          <Skeleton className="h-9 w-full motion-reduce:animate-none sm:w-40" />
        </div>
      </section>
    </AuthShell>
  );
}
