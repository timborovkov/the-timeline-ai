import { AuthShell } from '@/components/auth-shell';
import { Skeleton } from '@/components/ui/skeleton';

export default function SignInLoading() {
  return (
    <AuthShell
      title="Welcome back"
      subtitle="Sign in to your team’s timeline."
      secondaryPrefix="No account yet?"
      secondaryHref="/sign-up"
      secondaryLabel="Create one"
    >
      <output className="sr-only" aria-live="polite">
        Loading sign in
      </output>
      <section aria-busy="true" aria-label="Sign-in loading placeholder" className="space-y-4">
        <div aria-hidden="true" className="space-y-4">
          <div className="space-y-2">
            <Skeleton className="h-4 w-12 motion-reduce:animate-none" />
            <Skeleton className="h-9 w-full motion-reduce:animate-none" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-4 w-16 motion-reduce:animate-none" />
            <Skeleton className="h-9 w-full motion-reduce:animate-none" />
          </div>
          <Skeleton className="h-9 w-full motion-reduce:animate-none" />
        </div>
      </section>
    </AuthShell>
  );
}
