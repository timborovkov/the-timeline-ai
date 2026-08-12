import { cn } from '@/lib/utils';

const GITHUB_REPOSITORY_URL = 'https://github.com/timborovkov/the-timeline-ai';

export function GitHubSourceLink({
  className,
  compact = false,
}: {
  className?: string;
  compact?: boolean;
}) {
  return (
    <a
      href={GITHUB_REPOSITORY_URL}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={compact ? 'The Timeline source code on GitHub' : undefined}
      className={cn(
        'inline-flex min-h-10 items-center justify-center gap-2 rounded-sm border border-border bg-bg px-3 font-mono text-[10px] uppercase tracking-[0.14em] text-fg-muted transition-[color,background-color,border-color,transform] duration-[80ms] ease-out hover:border-border-strong hover:bg-surface hover:text-fg active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg motion-reduce:transition-none motion-reduce:active:scale-100',
        compact && 'size-10 px-0',
        className,
      )}
    >
      <GitHubMark />
      {compact ? null : <span>Source on GitHub</span>}
    </a>
  );
}

function GitHubMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4 shrink-0 fill-current">
      <path d="M12 2C6.48 2 2 6.58 2 12.23c0 4.52 2.87 8.35 6.84 9.71.5.1.68-.22.68-.49v-1.91c-2.78.62-3.37-1.21-3.37-1.21-.45-1.18-1.11-1.49-1.11-1.49-.91-.64.07-.62.07-.62 1 .08 1.53 1.06 1.53 1.06.9 1.57 2.35 1.12 2.92.86.09-.66.35-1.12.64-1.38-2.22-.26-4.56-1.14-4.56-5.06 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.71 0 0 .84-.28 2.75 1.05A9.3 9.3 0 0 1 12 6.95a9.3 9.3 0 0 1 2.5.35c1.91-1.33 2.75-1.05 2.75-1.05.55 1.41.2 2.45.1 2.71.64.72 1.03 1.63 1.03 2.75 0 3.93-2.34 4.8-4.57 5.06.36.32.68.94.68 1.89v2.8c0 .27.18.59.69.49A10.24 10.24 0 0 0 22 12.23C22 6.58 17.52 2 12 2Z" />
    </svg>
  );
}
