import { ArrowLeft, ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import type { Metadata } from 'next';

import { AgentInstallGuide } from '@/components/help/agent-install-guide';
import { HelpAppLink } from '@/components/help/app-link';
import { Button } from '@/components/ui/button';
import { auth } from '@/lib/auth';
import { findHelpPage, HELP_PAGES } from '@/lib/help-content';
import { publicMetadata } from '@/lib/public-metadata';

interface HelpPageProps {
  params: Promise<{ slug: string }>;
}

export function generateStaticParams() {
  return HELP_PAGES.map((page) => ({ slug: page.slug }));
}

export async function generateMetadata({ params }: HelpPageProps): Promise<Metadata> {
  const { slug } = await params;
  const page = findHelpPage(slug);
  if (!page) return {};
  return publicMetadata({
    title: page.title,
    description: page.description,
    path: `/help/${page.slug}`,
  });
}

export default async function HelpTopicPage({ params }: HelpPageProps) {
  const { slug } = await params;
  const page = findHelpPage(slug);
  if (!page) notFound();

  const session = await auth();
  const isSignedIn = Boolean(session?.user);

  if (page.slug === 'agents') {
    return (
      <article className="space-y-14">
        <AgentInstallGuide isSignedIn={isSignedIn} />
        <RelatedGuides related={page.related} />
      </article>
    );
  }

  return (
    <article className="space-y-10">
      <header className="max-w-[70ch] space-y-4">
        <Link
          href="/help"
          className="inline-flex min-h-10 items-center gap-2 rounded-sm text-sm font-medium text-fg-muted transition-colors hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fg focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
        >
          <ArrowLeft aria-hidden="true" className="size-4" />
          All guides
        </Link>
        <div className="flex items-center gap-3">
          <page.icon className="size-8 text-signal" />
          <h1 className="text-3xl font-semibold tracking-tight text-fg sm:text-4xl">
            {page.title}
          </h1>
        </div>
        <p className="text-lg text-fg-muted">{page.description}</p>
      </header>

      <div className="space-y-8">
        {page.sections.map((section) => (
          <section key={section.title} className="border-t border-border pt-8">
            <div className="grid gap-6 lg:grid-cols-[1fr_14rem]">
              <div className="space-y-4">
                <h2 className="text-2xl font-semibold text-fg">{section.title}</h2>
                <p className="text-base text-fg-muted">{section.body}</p>
                {section.items ? (
                  <ul className="space-y-3">
                    {section.items.map((item) => (
                      <li key={item} className="flex gap-3 text-sm text-fg">
                        <span className="mt-2 size-1.5 shrink-0 rounded-full bg-signal" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
              {section.appLink || section.resourceLinks?.length ? (
                <div className="flex flex-col items-start gap-2 lg:pt-11">
                  {section.appLink ? (
                    <HelpAppLink
                      href={section.appLink.href}
                      label={section.appLink.label}
                      isSignedIn={isSignedIn}
                    />
                  ) : null}
                  {section.resourceLinks?.map((link) => (
                    <Button key={link.href} asChild size="sm" variant="outline">
                      <a href={link.href} target="_blank" rel="noreferrer">
                        {link.label}
                        <ExternalLink aria-hidden="true" className="size-3.5" />
                      </a>
                    </Button>
                  ))}
                </div>
              ) : null}
            </div>
          </section>
        ))}
      </div>

      <RelatedGuides related={page.related} />
    </article>
  );
}

function RelatedGuides({ related }: { related: string[] }) {
  return (
    <section className="border-t border-border pt-8">
      <h2 className="mb-3 text-base font-semibold text-fg">Related</h2>
      <div className="flex flex-wrap gap-2">
        {related.map((relatedSlug) => {
          const relatedPage = findHelpPage(relatedSlug);
          if (!relatedPage) return null;
          return (
            <Link
              key={relatedPage.slug}
              href={`/help/${relatedPage.slug}`}
              className="rounded-sm border border-border px-3 py-2 text-sm text-fg-muted transition-colors hover:border-signal/50 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fg focus-visible:ring-offset-2 focus-visible:ring-offset-bg forced-colors:focus-visible:outline forced-colors:focus-visible:outline-2"
            >
              {relatedPage.title}
            </Link>
          );
        })}
        <Link
          href="/help/support"
          className="rounded-sm border border-border px-3 py-2 text-sm text-fg-muted transition-colors hover:border-signal/50 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fg focus-visible:ring-offset-2 focus-visible:ring-offset-bg forced-colors:focus-visible:outline forced-colors:focus-visible:outline-2"
        >
          Contact support
        </Link>
      </div>
    </section>
  );
}
