import { AuthShell } from '@/components/auth-shell';
import { Skeleton } from '@/components/ui/skeleton';

export default function VerifyEmailLoading() {
  return (
    <AuthShell title="Verifying email">
      <output className="sr-only" aria-live="polite">
        Verifying email
      </output>
      <section
        aria-busy="true"
        aria-label="Email verification loading placeholder"
        className="space-y-5"
      >
        <div aria-hidden="true" className="space-y-2">
          <Skeleton className="h-4 w-full motion-reduce:animate-none" />
          <Skeleton className="h-4 w-3/4 motion-reduce:animate-none" />
        </div>
        <Skeleton className="h-9 w-32 motion-reduce:animate-none" />
      </section>
    </AuthShell>
  );
}
