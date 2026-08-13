import { ArrowRight, BookOpen, FileSearch, NotebookPen, ScrollText } from 'lucide-react';
import Link from 'next/link';

import type { Metadata } from 'next';

import {
  EDITORIAL_CONTENT_TYPES,
  EDITORIAL_GUIDES,
  EDITORIAL_PUBLICATION_NAME,
  findEditorialGuideByRoute,
  GUIDE_ROUTES,
} from '@/components/marketing/editorial/content';
import { EditorialKicker } from '@/components/marketing/editorial/editorial-kicker';
import { EditorialSectionHeading } from '@/components/marketing/editorial/editorial-section-heading';
import { EditorialStructuredData } from '@/components/marketing/editorial/editorial-structured-data';
import styles from '@/components/marketing/editorial/editorial.module.css';
import {
  buildRecordStructuredData,
  createRecordMetadata,
} from '@/components/marketing/editorial/metadata';
import { ProvenanceDiagram } from '@/components/marketing/editorial/provenance-diagram';

export const metadata: Metadata = createRecordMetadata();

const TYPE_ICONS = {
  essay: NotebookPen,
  playbook: BookOpen,
  dossier: FileSearch,
  'product-note': ScrollText,
} as const;

export default function RecordPage() {
  const featuredGuide = findEditorialGuideByRoute(GUIDE_ROUTES.slackAndDrive);

  return (
    <main id="main" tabIndex={-1}>
      <EditorialStructuredData data={buildRecordStructuredData()} />
      <section className="mx-auto max-w-[94rem] px-4 pt-16 pb-20 sm:px-6 sm:pt-24 sm:pb-28 lg:px-10 lg:pt-32">
        <div className={styles.heroGrid}>
          <div>
            <EditorialKicker>Publication / Field notes / Edition 001</EditorialKicker>
            <h1 className={`${styles.displayTitle} mt-7`}>
              {EDITORIAL_PUBLICATION_NAME} <span className={styles.serifAccent}>keeps</span> the
              receipts.
            </h1>
            <p className="mt-8 max-w-2xl text-lg leading-8 text-fg-muted sm:text-xl">
              Essays, playbooks, dossiers, and product notes about turning scattered work into
              chronology, then cited operational memory.
            </p>
            <p className="mt-5 max-w-xl text-sm leading-7 text-fg-dim">
              “{EDITORIAL_PUBLICATION_NAME}” is a provisional public name, isolated from the
              editorial structure so the publication can be renamed without changing its routes or
              content model.
            </p>
          </div>
          <ProvenanceDiagram diagram={featuredGuide.diagram} answerHeadingLevel={2} />
        </div>
      </section>

      <section className="border-y border-border bg-surface/50">
        <div className="mx-auto max-w-[94rem] px-4 py-16 sm:px-6 sm:py-24 lg:px-10">
          <EditorialSectionHeading
            index="01 / The desk"
            title="Four forms for understanding how work becomes evidence."
            intro="Shared publishing structure, distinct editorial purpose. Each form earns its place by answering a different kind of question."
          />
          <div className="mt-12 grid gap-px overflow-hidden rounded-md border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
            {EDITORIAL_CONTENT_TYPES.map((type) => {
              const Icon = TYPE_ICONS[type.id];
              return (
                <section key={type.id} className="min-h-64 bg-bg p-6 sm:p-7">
                  <div className="flex items-center justify-between gap-4">
                    <span className="font-mono text-[0.65rem] tracking-[0.13em] text-signal uppercase">
                      {type.index}
                    </span>
                    <Icon aria-hidden="true" className="size-5 text-fg-dim" />
                  </div>
                  <h2 className="mt-14 text-2xl font-semibold tracking-[-0.035em]">{type.label}</h2>
                  <p className="mt-4 text-sm leading-7 text-fg-muted">{type.description}</p>
                </section>
              );
            })}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[94rem] px-4 py-16 sm:px-6 sm:py-24 lg:px-10">
        <EditorialSectionHeading
          index="02 / First edition"
          title="Three questions that cross the tools where work actually happened."
          intro="Every guide leads with a direct answer, then opens the workflow, provenance map, source boundaries, limitations, and query contract."
        />
        <div className="mt-12 grid gap-6 lg:grid-cols-12">
          {EDITORIAL_GUIDES.map((guide, index) => (
            <article
              key={guide.route}
              className={`${styles.editorialCard} ${index === 0 ? 'lg:col-span-7' : index === 1 ? 'lg:col-span-5' : 'lg:col-span-12'} p-6 sm:p-8`}
            >
              <div className="relative z-10 flex h-full min-h-80 flex-col">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <p className="font-mono text-[0.65rem] tracking-[0.12em] text-signal uppercase">
                    {guide.issue} / {guide.typeLabel}
                  </p>
                  <p className="font-mono text-[0.62rem] tracking-[0.08em] text-fg-dim uppercase">
                    {guide.nativeConnectors.join(' + ')}
                  </p>
                </div>
                <h2
                  className={`${index === 2 ? 'max-w-5xl text-3xl sm:text-5xl' : 'max-w-2xl text-3xl sm:text-4xl'} mt-14 text-balance font-semibold tracking-[-0.045em]`}
                >
                  {guide.title}
                </h2>
                <p className="mt-5 max-w-3xl text-sm leading-7 text-fg-muted sm:text-base">
                  {guide.summary}
                </p>
                <Link
                  href={guide.route}
                  className="group mt-auto inline-flex w-fit items-center gap-3 rounded-sm pt-10 font-semibold outline-none hover:text-signal focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4"
                >
                  Read the field guide
                  <ArrowRight
                    aria-hidden="true"
                    className="size-4 motion-safe:transition-transform motion-safe:group-hover:translate-x-1"
                  />
                </Link>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className={`${styles.ctaStage} mx-auto max-w-[94rem] px-6 py-16 sm:px-10 sm:py-24`}>
        <div className="relative z-10 max-w-4xl">
          <EditorialKicker>The editorial contract / Answer first</EditorialKicker>
          <h2 className="mt-6 text-balance text-4xl font-semibold tracking-[-0.05em] sm:text-5xl lg:text-6xl">
            Useful before persuasive. Cited before certain.
          </h2>
          <p className="mt-7 max-w-2xl text-base leading-8 opacity-72 sm:text-lg">
            The publication does not invent performance claims, customer stories, or capability. It
            shows what the system can inspect, where the evidence ends, and which judgment still
            belongs to a person.
          </p>
          <Link
            href={featuredGuide.route}
            className="mt-9 inline-flex min-h-12 items-center gap-8 rounded-sm bg-signal px-5 font-semibold text-signal-fg outline-none hover:brightness-95 focus-visible:ring-2 focus-visible:ring-bg focus-visible:ring-offset-2 focus-visible:ring-offset-fg"
          >
            Start with cross-tool search
            <ArrowRight aria-hidden="true" className="size-4" />
          </Link>
        </div>
      </section>
    </main>
  );
}
