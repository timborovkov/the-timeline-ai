import { AuthShell } from '@/components/auth-shell';
import { Skeleton } from '@/components/ui/skeleton';

export default function VerifyEmailLoading() {
  return (
    <AuthShell title="Verifying email">
      <output className="sr-only">Verifying email</output>
      <section
        aria-busy="true"
        aria-label="Email verification loading placeholder"
        className="space-y-5"
      >
        <div className="space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </div>
        <Skeleton className="h-9 w-32" />
      </section>
    </AuthShell>
  );
}
