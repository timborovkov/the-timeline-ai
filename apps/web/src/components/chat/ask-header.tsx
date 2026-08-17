interface AskHeaderProps {
  teamName: string;
  activeTitle: string | null;
}

export function AskHeader({ teamName, activeTitle }: AskHeaderProps) {
  return (
    <header
      className="mb-5 flex min-w-0 shrink-0 items-baseline gap-x-3 border-b border-border pb-3"
      aria-label={activeTitle ? `Ask · ${activeTitle}` : `Chat with ${teamName}'s timeline`}
    >
      <h1 className="shrink-0 text-2xl font-semibold tracking-tight text-fg">Ask</h1>
      {activeTitle ? (
        <p className="min-w-0 truncate text-sm text-fg-muted" title={activeTitle}>
          {activeTitle}
        </p>
      ) : null}
    </header>
  );
}
