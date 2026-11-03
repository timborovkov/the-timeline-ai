import type { WorksWithTool } from '@/components/marketing/integrations/works-with-content';

export function WorksWithGuidance({ tool }: { tool: WorksWithTool }) {
  return (
    <>
      <WorksWithCopyBlock
        labelledBy="getting-started"
        index="Start"
        label="Getting started"
        title="Just getting started? You may not need one yet"
        body={tool.gettingStarted}
      />
      <WorksWithCopyBlock
        labelledBy="when-alone"
        index="Better"
        label="When it stands alone"
        title={`When ${tool.name} alone is the better pick`}
        body={tool.whenAloneBetter}
      />
    </>
  );
}

function WorksWithCopyBlock({
  labelledBy,
  index,
  label,
  title,
  body,
}: {
  labelledBy: string;
  index: string;
  label: string;
  title: string;
  body: string;
}) {
  return (
    <section className="border-b border-border py-16 sm:py-20" aria-labelledby={labelledBy}>
      <div className="grid gap-8 lg:grid-cols-[0.45fr_1fr]">
        <p className="flex items-baseline gap-1.5 text-sm font-medium text-fg-muted">
          <span className="font-mono text-[11px] text-fg-dim">{index}</span>
          <span aria-hidden="true">/</span>
          <span>{label}</span>
        </p>
        <div>
          <h2 id={labelledBy} className="text-3xl font-semibold tracking-tight sm:text-4xl">
            {title}
          </h2>
          <p className="mt-4 max-w-[66ch] text-base leading-relaxed text-fg-muted">{body}</p>
        </div>
      </div>
    </section>
  );
}
