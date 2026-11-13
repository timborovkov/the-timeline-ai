export function EditorialSectionHeading({ title, intro }: { title: string; intro?: string }) {
  return (
    <div className="min-w-0">
      <h2 className="text-balance text-2xl font-medium leading-[1.15] tracking-[-0.025em] sm:text-3xl lg:text-4xl">
        {title}
      </h2>
      {intro ? (
        <p className="mt-4 max-w-[68ch] text-base leading-7 text-fg-muted sm:text-lg">{intro}</p>
      ) : null}
    </div>
  );
}
