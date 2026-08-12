import { ShieldCheck } from 'lucide-react';

import type { EditorialGuide } from '@/components/marketing/editorial/content';

import { EditorialSectionHeading } from '@/components/marketing/editorial/editorial-section-heading';
import styles from '@/components/marketing/editorial/editorial.module.css';
import { ProvenanceDiagram } from '@/components/marketing/editorial/provenance-diagram';

export function GuideMethodSections({ guide }: { guide: EditorialGuide }) {
  return (
    <>
      <section className="border-y border-border bg-surface/45">
        <div className="mx-auto max-w-[94rem] px-4 py-16 sm:px-6 sm:py-20 lg:px-10">
          <EditorialSectionHeading title="The sources play different roles. Preserve that difference." />
          <div className={`${styles.readingMeasure} mt-10 ml-auto space-y-6 text-base leading-8`}>
            {guide.context.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[94rem] px-4 py-16 sm:px-6 sm:py-24 lg:px-10">
        <EditorialSectionHeading
          title="Build the answer in inspectable stages."
          intro="Each stage produces an artifact you can review before the next layer adds interpretation."
        />
        <ol className="mt-12 ml-auto grid max-w-4xl gap-10">
          {guide.workflow.map((step) => (
            <li
              key={step.index}
              className={`${styles.workflowStep} grid grid-cols-[2rem_minmax(0,1fr)] gap-5 sm:grid-cols-[2rem_minmax(0,1fr)_minmax(12rem,0.38fr)] sm:gap-7`}
            >
              <span className={`${styles.workflowIndex} font-mono text-[0.62rem]`}>
                {step.index}
              </span>
              <div>
                <h3 className="text-xl font-semibold tracking-[-0.025em]">{step.title}</h3>
                <p className="mt-3 text-sm leading-7 text-fg-muted sm:text-base">{step.body}</p>
              </div>
              <div className="col-start-2 border-l border-border pl-4 sm:col-start-auto">
                <p className="font-mono text-[0.62rem] tracking-[0.12em] text-signal uppercase">
                  Output
                </p>
                <p className="mt-2 text-sm leading-6 text-fg-muted">{step.output}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="border-y border-border bg-surface/55">
        <div className="mx-auto max-w-[94rem] px-4 py-16 sm:px-6 sm:py-24 lg:px-10">
          <EditorialSectionHeading
            index="03 / Provenance map"
            title="Watch the evidence become chronology, then an answer."
            intro="The example is illustrative. Its purpose is to make the provenance pattern visible, not to imply customer data or a guaranteed conclusion."
          />
          <div className="mt-12">
            <ProvenanceDiagram diagram={guide.diagram} />
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[94rem] px-4 py-16 sm:px-6 sm:py-24 lg:px-10">
        <EditorialSectionHeading title="Ask for a result that can admit uncertainty." />
        <div className={`${styles.promptBlock} mt-12 rounded-md p-6 sm:p-10 lg:ml-[28%]`}>
          <div className="relative z-10">
            <p className="font-mono text-[0.65rem] tracking-[0.14em] text-signal uppercase">
              Prompt pattern / Adapt the brackets
            </p>
            <blockquote className="mt-8 max-w-4xl text-balance text-xl leading-9 font-medium tracking-[-0.02em] sm:text-2xl sm:leading-10">
              “{guide.prompt}”
            </blockquote>
            <p className="mt-8 max-w-2xl text-sm leading-7 opacity-70">
              A good query fixes the scope, time window, output shape, citation requirement, and
              treatment of missing or conflicting evidence.
            </p>
          </div>
        </div>
      </section>

      <section className="border-y border-border bg-surface/45">
        <div className="mx-auto max-w-[94rem] px-4 py-16 sm:px-6 sm:py-24 lg:px-10">
          <EditorialSectionHeading
            index="05 / Source boundaries"
            title="Know exactly what each connector contributes."
            intro="These guides describe native ingestion. They do not relabel MCP access or planned support as native capability."
          />
          <div className="mt-12 grid gap-px overflow-hidden rounded-md border border-border bg-border lg:grid-cols-3">
            {guide.boundaries.map((boundary) => (
              <section key={boundary.provider} className="bg-bg p-6 sm:p-8">
                <div className="flex items-center justify-between gap-4">
                  <p className="font-mono text-[0.65rem] tracking-[0.12em] text-signal uppercase">
                    Native / {boundary.provider}
                  </p>
                  <ShieldCheck aria-hidden="true" className="size-4 text-fg-dim" />
                </div>
                <h3 className="mt-7 text-xl font-semibold tracking-[-0.025em]">{boundary.role}</h3>
                <p className="mt-4 text-sm leading-7 text-fg-muted">{boundary.includes}</p>
                <div className="mt-6 border-t border-border pt-5">
                  <p className="font-mono text-[0.62rem] tracking-[0.12em] text-fg-dim uppercase">
                    Boundary
                  </p>
                  <p className="mt-2 text-sm leading-7">{boundary.boundary}</p>
                </div>
              </section>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
