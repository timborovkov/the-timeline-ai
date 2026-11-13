import Link from 'next/link';

import { Button } from '@/components/ui/button';

export function HomeProcessingAttention({
  isAdmin,
  recoverableJobs,
  connectionIssues,
}: {
  isAdmin: boolean;
  recoverableJobs: number;
  connectionIssues: number;
}) {
  const visibleJobs = isAdmin ? recoverableJobs : 0;
  if (visibleJobs === 0 && connectionIssues === 0) return null;
  return (
    <section
      aria-label="Connections & processing"
      className="space-y-4 border-t border-border pt-5"
    >
      <h2 className="text-sm font-semibold">Connections & processing</h2>
      {visibleJobs > 0 ? (
        <div className="space-y-3">
          <div>
            <p className="text-sm font-medium">
              {visibleJobs} {visibleJobs === 1 ? 'item needs' : 'items need'} another attempt
            </p>
            <p className="mt-1 text-xs leading-5 text-fg-muted">
              Some background processing failed. Review the affected items and retry them from
              processing settings.
            </p>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link href="/app/team/jobs">Review processing</Link>
          </Button>
        </div>
      ) : null}
      {connectionIssues > 0 ? (
        <div className="space-y-3">
          <p className="text-sm text-fg-muted">
            {connectionIssues} {connectionIssues === 1 ? 'connection needs' : 'connections need'}{' '}
            attention.
          </p>
          <Button asChild variant="outline" size="sm">
            <Link href="/app/connections">Review connections</Link>
          </Button>
        </div>
      ) : null}
    </section>
  );
}
