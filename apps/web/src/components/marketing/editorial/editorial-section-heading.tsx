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
    <div className="max-w-3xl border-t border-border pt-5">
      {index ? (
        <p className="mb-5 font-mono text-[0.68rem] tracking-[0.14em] text-signal uppercase">
          {index}
        </p>
      ) : null}
      <h2 className="text-balance text-2xl font-semibold tracking-[-0.035em] sm:text-3xl lg:text-4xl">
        {title}
      </h2>
      {intro ? (
        <p className="mt-4 max-w-2xl text-base leading-7 text-fg-muted sm:text-lg">{intro}</p>
      ) : null}
    </div>
  );
}
