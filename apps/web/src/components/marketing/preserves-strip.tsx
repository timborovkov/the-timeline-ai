const PRESERVED = [
  { term: 'Content', detail: 'Kept as received' },
  { term: 'Time', detail: 'Placed on one chronology' },
  { term: 'Visibility', detail: 'Carried into every answer' },
] as const;

export function PreservesStrip() {
  return (
    <aside
      aria-label="What Timeline preserves"
      data-preserves-strip
      className="border border-border bg-bg p-6 sm:p-8"
    >
      <p className="font-mono text-[0.68rem] tracking-[0.14em] text-signal uppercase">
        What Timeline preserves
      </p>
      <dl className="mt-6 grid gap-6 sm:grid-cols-3">
        {PRESERVED.map((item) => (
          <div key={item.term}>
            <dt className="font-mono text-[0.68rem] tracking-[0.12em] text-fg-dim uppercase">
              {item.term}
            </dt>
            <dd className="mt-2 text-base font-medium text-fg">{item.detail}</dd>
          </div>
        ))}
      </dl>
    </aside>
  );
}
