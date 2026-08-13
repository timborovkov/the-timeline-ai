export function EditorialSectionHeading({
  index,
  title,
  intro,
}: {
  index?: string;
  title: string;
  intro?: string;
}) {
  return (
    <div className="grid gap-5 border-t border-border pt-5 md:grid-cols-[minmax(9rem,0.32fr)_minmax(0,1fr)] md:gap-12">
      {index ? (
        <p className="font-mono text-[0.68rem] tracking-[0.14em] text-signal uppercase">{index}</p>
      ) : (
        <span aria-hidden="true" className="hidden md:block" />
      )}
      <div>
        <h2 className="max-w-3xl text-balance text-3xl font-semibold tracking-[-0.04em] sm:text-4xl lg:text-5xl">
          {title}
        </h2>
        {intro ? (
          <p className="mt-5 max-w-2xl text-base leading-7 text-fg-muted sm:text-lg">{intro}</p>
        ) : null}
      </div>
    </div>
  );
}
