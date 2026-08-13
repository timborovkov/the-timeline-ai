import type { EditorialDiagram } from '@/components/marketing/editorial/content';

import styles from '@/components/marketing/editorial/editorial.module.css';
import { ProvenanceReveal } from '@/components/marketing/editorial/provenance-reveal';

export function ProvenanceDiagram({
  diagram,
  answerHeadingLevel = 3,
}: {
  diagram: EditorialDiagram;
  answerHeadingLevel?: 2 | 3;
}) {
  const answerHeadingClassName =
    'mt-8 text-balance text-2xl font-semibold tracking-[-0.035em] sm:text-3xl';

  return (
    <ProvenanceReveal>
      <figure className={`${styles.provenanceStage} p-4 sm:p-6 lg:p-8`}>
        <figcaption className="relative z-10 flex flex-col gap-2 border-b border-border pb-4 sm:flex-row sm:items-center sm:justify-between">
          <span className="font-mono text-[0.65rem] tracking-[0.13em] text-signal uppercase">
            {diagram.label}
          </span>
          <span className="font-mono text-[0.65rem] tracking-[0.08em] text-fg-dim uppercase">
            Example / not customer data
          </span>
        </figcaption>
        <div className="relative z-10 mt-6 rounded-md border border-border bg-bg/90 p-4">
          <p className="font-mono text-[0.65rem] tracking-[0.12em] text-fg-dim uppercase">
            Question
          </p>
          <p className="mt-2 text-base font-medium leading-6">{diagram.query}</p>
        </div>
        <div className="relative mt-6 grid gap-5 md:grid-cols-[minmax(0,0.92fr)_1px_minmax(0,1.08fr)] md:gap-8">
          <div className={`${styles.sourceStack} grid content-start gap-3`}>
            {diagram.sources.map((source, index) => (
              <div
                key={`${source.provider}-${source.stamp}`}
                className={`${styles.sourceCard} p-4`}
              >
                <div className="flex items-center justify-between gap-3 font-mono text-[0.62rem] tracking-[0.1em] uppercase">
                  <span className="text-signal">
                    {String(index + 1).padStart(2, '0')} / {source.provider}
                  </span>
                  <span className="text-fg-dim">{source.stamp}</span>
                </div>
                <p className="mt-3 text-sm leading-6 text-fg-muted">{source.signal}</p>
              </div>
            ))}
          </div>
          <div className={`${styles.chronologyRail} hidden md:block`} aria-hidden="true">
            {diagram.sources.map((source, index) => (
              <span
                key={`${source.stamp}-node`}
                className={styles.railNode}
                style={{ top: `${((index + 0.5) / diagram.sources.length) * 100}%` }}
              />
            ))}
          </div>
          <div className={`${styles.answerCard} p-5 sm:p-6`}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="font-mono text-[0.65rem] tracking-[0.13em] text-signal uppercase">
                Answer / cited
              </span>
              <span className="font-mono text-[0.62rem] tracking-[0.08em] text-fg-dim uppercase">
                {diagram.sources.length} sources
              </span>
            </div>
            {answerHeadingLevel === 2 ? (
              <h2 className={answerHeadingClassName}>{diagram.answerTitle}</h2>
            ) : (
              <h3 className={answerHeadingClassName}>{diagram.answerTitle}</h3>
            )}
            <p className="mt-4 text-sm leading-7 text-fg-muted sm:text-base">
              {diagram.answerBody}{' '}
              <span className="inline-flex flex-wrap gap-1 align-middle">
                {diagram.citations.map((citation) => (
                  <span key={citation} className={styles.citation}>
                    <span className="sr-only">Source citation </span>
                    {citation}
                  </span>
                ))}
              </span>
            </p>
            <ol className="mt-8 grid gap-2 border-t border-border pt-4 font-mono text-[0.62rem] tracking-[0.08em] text-fg-dim uppercase">
              {diagram.chronology.map((event, index) => (
                <li key={event} className="grid grid-cols-[2rem_1fr] gap-2">
                  <span>{String(index + 1).padStart(2, '0')}</span>
                  <span>{event}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </figure>
    </ProvenanceReveal>
  );
}
