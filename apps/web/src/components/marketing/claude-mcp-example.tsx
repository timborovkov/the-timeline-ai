const SOURCES = [
  {
    id: 'claude-mcp-source-1',
    n: 1,
    title: 'Email from Elena Park',
    detail: 'Northstar pilot export commitment',
  },
  {
    id: 'claude-mcp-source-2',
    n: 2,
    title: 'Call transcript',
    detail: 'Northstar pilot handoff review',
  },
] as const;

export function ClaudeMcpExample() {
  return (
    <article
      data-claude-mcp-example
      aria-label="Claude MCP example"
      className="border border-border bg-bg"
    >
      <header className="flex justify-between gap-4 border-b border-border px-4 py-3 text-sm text-fg-muted">
        <span>Claude</span>
        <span>MCP</span>
      </header>
      <p className="px-4 pt-4 text-base text-fg">What did we promise Northstar?</p>
      <ol className="mt-3 grid gap-2 px-4">
        <li className="border-b border-border px-0 py-2">
          <code className="font-mono text-xs text-signal">timeline.subject</code>
          <span className="mt-1 block text-sm text-fg-muted">subject: Northstar</span>
        </li>
        <li className="border-b border-border px-0 py-2">
          <code className="font-mono text-xs text-signal">timeline.get</code>
          <span className="mt-1 block text-sm text-fg-muted">
            name: Northstar pilot handoff review
          </span>
        </li>
      </ol>
      <p className="px-4 py-4 text-sm leading-7 text-fg-muted">
        Northstar Works committed to send the final sample export by July 8
        <SourceLink n={1} label="Email from Elena Park" />. Avery handed export validation to Mika,
        and the team decided to use the CSV fallback
        <SourceLink n={2} label="Call transcript" />.
      </p>
      <ol className="mx-4 mb-4 grid gap-3 border-t border-border pt-4">
        {SOURCES.map((source) => (
          <li key={source.id} id={source.id} className="text-sm">
            <span className="font-mono text-xs text-signal">[{source.n}]</span>{' '}
            <strong className="font-semibold text-fg">{source.title}</strong>
            <span className="mt-1 block text-fg-muted">{source.detail}</span>
          </li>
        ))}
      </ol>
    </article>
  );
}

function SourceLink({ n, label }: { n: number; label: string }) {
  return (
    <a href={`#claude-mcp-source-${n}`} className="text-signal">
      <sup aria-hidden="true">[{n}]</sup>
      <span className="sr-only">
        Source {n}: {label}
      </span>
    </a>
  );
}
