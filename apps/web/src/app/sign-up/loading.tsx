import { AuthShell } from '@/components/auth-shell';
import { Skeleton } from '@/components/ui/skeleton';

export default function SignUpLoading() {
  return (
    <AuthShell title="Create your account" subtitle="We’ll create your first team automatically.">
      <output className="sr-only" aria-live="polite">
        Loading account creation
      </output>
      <section
        aria-busy="true"
        aria-label="Account creation loading placeholder"
        className="space-y-4"
      >
        <div aria-hidden="true" className="space-y-4">
          <div className="space-y-2">
            <Skeleton className="h-4 w-10 motion-reduce:animate-none" />
            <Skeleton className="h-9 w-full motion-reduce:animate-none" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-4 w-12 motion-reduce:animate-none" />
            <Skeleton className="h-9 w-full motion-reduce:animate-none" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-4 w-16 motion-reduce:animate-none" />
            <Skeleton className="h-9 w-full motion-reduce:animate-none" />
          </div>
          <div className="flex items-start gap-3">
            <Skeleton className="mt-1 size-4 shrink-0 motion-reduce:animate-none" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-full motion-reduce:animate-none" />
              <Skeleton className="h-4 w-3/4 motion-reduce:animate-none" />
            </div>
          </div>
          <Skeleton className="h-9 w-full motion-reduce:animate-none" />
        </div>
      </section>
    </AuthShell>
  );
}
