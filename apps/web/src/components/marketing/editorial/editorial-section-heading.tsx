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
    <div className="min-w-0">
      {index ? (
        <p className="mb-3 font-mono text-[0.68rem] tracking-[0.14em] text-signal uppercase">
          {index}
        </p>
      ) : null}
      <h2 className="text-balance text-2xl font-medium leading-[1.15] tracking-[-0.025em] sm:text-3xl lg:text-4xl">
        {title}
      </h2>
      {intro ? (
        <p className="mt-4 max-w-2xl text-base leading-7 text-fg-muted sm:text-lg">{intro}</p>
      ) : null}
    </div>
  );
}
