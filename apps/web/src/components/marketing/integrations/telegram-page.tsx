import { ArrowRight } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';

import { EditorialStructuredData } from '@/components/marketing/editorial/editorial-structured-data';
import { TELEGRAM_PUBLIC_DOCUMENT } from '@/components/marketing/integrations/connector-public-documents';
import styles from '@/components/marketing/integrations/integration-detail.module.css';
import { IntegrationSourceFeed } from '@/components/marketing/integrations/integration-source-feed';
import { TELEGRAM_PAGE } from '@/components/marketing/integrations/telegram-content';
import { MarketingContainer, MarketingSectionGrid } from '@/components/marketing/marketing-layout';
import { MarketingProductScreenshot } from '@/components/marketing/product-screenshot';
import { MarketingCtaBand, StartFreeLink } from '@/components/marketing/start-free-cta';
import { PublicSessionBranch } from '@/components/public-session-branch';
import { PublicShell } from '@/components/public-shell';
import { buildPublicStructuredData } from '@/lib/public-site';
import { getSiteUrl } from '@/lib/site-url';

export function TelegramIntegrationPage() {
  return (
    <PublicShell footerLabel="Telegram integration" currentSection="integrations">
      <EditorialStructuredData
        data={buildPublicStructuredData(TELEGRAM_PUBLIC_DOCUMENT, getSiteUrl())}
      />
      <main id="main" tabIndex={-1} data-telegram-integration>
        <section className="border-b border-border">
          <MarketingContainer className={styles.hero}>
            <Link href="/integrations" className={styles.back}>
              All integrations
            </Link>
            <div className={styles.heroGrid}>
              <div>
                <div className={styles.identity}>
                  <span className="grid size-10 place-items-center rounded-sm border border-border bg-white">
                    <Image src="/connectors/telegram.svg" alt="" width={26} height={26} />
                  </span>
                  <span>Telegram · Deliberate capture</span>
                </div>
                <h1 className={styles.title}>{TELEGRAM_PAGE.title}</h1>
                <p className={styles.intro}>{TELEGRAM_PAGE.summary}</p>
                <div className={styles.actions}>
                  <StartFreeLink className="inline-flex min-h-12 items-center gap-3 rounded-sm bg-signal px-5 font-semibold text-signal-fg focus-visible:outline-2" />
                  <PublicSessionBranch
                    signedOut={
                      <Link href="#telegram-capture" className="py-3 underline underline-offset-4">
                        See what joins the record
                      </Link>
                    }
                    signedIn={
                      <Link
                        href={TELEGRAM_PAGE.setupHref}
                        className="py-3 underline underline-offset-4"
                      >
                        {TELEGRAM_PAGE.setupLabel}
                        <ArrowRight aria-hidden="true" className="ml-2 inline size-4" />
                      </Link>
                    }
                  />
                </div>
                <p className={styles.note}>
                  Link the chats you choose. Your whole Telegram account is not synced.
                </p>
              </div>
              <figure className={styles.preview}>
                <div className={styles.previewHeader}>
                  <p>A message worth keeping.</p>
                  <Image src="/connectors/telegram.svg" alt="" width={24} height={24} />
                </div>
                <IntegrationSourceFeed
                  records={[
                    {
                      time: '08:46',
                      label: 'Acme launch group',
                      detail: '“We promised the customer an update on Friday.”',
                    },
                    {
                      time: '11:40',
                      label: 'Launch review',
                      detail: 'The meeting names SSO as the launch blocker.',
                    },
                  ]}
                />
                <div className={styles.result}>
                  <h2>The commitment stays in view.</h2>
                  <p>
                    The message joins the project’s history alongside the call, with its sender,
                    time and source intact.
                  </p>
                </div>
                <figcaption>Illustrative example · Telegram and meeting evidence</figcaption>
              </figure>
            </div>
          </MarketingContainer>
        </section>

        <section
          id="telegram-capture"
          className="scroll-mt-24 border-b border-border bg-surface/45"
        >
          <MarketingContainer className="py-10 sm:py-14">
            <MarketingSectionGrid>
              <div>
                <h2 className="max-w-[18ch] text-3xl font-semibold tracking-tight sm:text-4xl">
                  Messages, files and voice memos join the record.
                </h2>
                <p className="mt-4 max-w-[64ch] text-base leading-relaxed text-fg-muted">
                  {TELEGRAM_PAGE.captured}
                </p>
                <div className="mt-10">
                  <MarketingProductScreenshot
                    file={TELEGRAM_PAGE.screenshot.file}
                    alt={TELEGRAM_PAGE.screenshot.alt}
                    caption={TELEGRAM_PAGE.screenshot.caption}
                  />
                </div>
              </div>
            </MarketingSectionGrid>
          </MarketingContainer>
        </section>

        <section className="border-b border-border">
          <MarketingContainer className="py-10 sm:py-14">
            <MarketingSectionGrid>
              <div>
                <h2 className="max-w-[18ch] text-3xl font-semibold tracking-tight sm:text-4xl">
                  Capture is deliberate, not a silent account sync.
                </h2>
                <p className="mt-4 max-w-[64ch] text-base leading-relaxed text-fg-muted">
                  {TELEGRAM_PAGE.boundary}
                </p>
              </div>
            </MarketingSectionGrid>
          </MarketingContainer>
        </section>

        <section>
          <MarketingContainer className="py-10 sm:py-14">
            <MarketingSectionGrid>
              <div>
                <h2 className="max-w-[18ch] text-3xl font-semibold tracking-tight sm:text-4xl">
                  Get the workspace update in Telegram.
                </h2>
                <p className="mt-4 max-w-[64ch] text-base leading-relaxed text-fg-muted">
                  {TELEGRAM_PAGE.dailyUpdate}
                </p>
              </div>
            </MarketingSectionGrid>
          </MarketingContainer>
        </section>

        <MarketingCtaBand
          title="Link one Telegram group."
          body="Messages, files and voice memos join the work record with their source. Ask The Timeline questions without leaving the chat."
        />
      </main>
    </PublicShell>
  );
}
