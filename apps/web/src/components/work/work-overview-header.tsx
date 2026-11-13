import Link from 'next/link';

export function WorkOverviewHeader({
  queueCount,
  overdueCount,
  approvalCount,
}: {
  queueCount: number;
  overdueCount: number;
  approvalCount: number;
}) {
  return (
    <header className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Work</h1>
        <Link
          href="/app/objects/new"
          className="inline-flex min-h-10 items-center rounded-sm bg-signal px-4 text-sm font-medium text-signal-fg transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          New task
        </Link>
      </div>
      <p className="text-sm leading-6 text-fg-muted">
        Prioritized work that needs a decision, owner, or next action.
      </p>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fg-muted">
        <span>
          <span className="font-mono text-fg">{queueCount}</span> in your queue
        </span>
        {overdueCount > 0 ? (
          <Link
            href="/app/tasks?due=overdue"
            className="inline-flex min-h-8 items-center gap-1.5 text-danger hover:underline"
          >
            <span className="font-mono">{overdueCount}</span> overdue
          </Link>
        ) : null}
        {approvalCount > 0 ? (
          <Link
            href="/app/approvals?status=pending"
            className="inline-flex min-h-8 items-center gap-1.5 text-signal hover:underline"
          >
            <span className="font-mono">{approvalCount}</span> pending approvals
          </Link>
        ) : null}
      </div>
    </header>
  );
}
