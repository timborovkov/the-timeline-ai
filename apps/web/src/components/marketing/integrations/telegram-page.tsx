import { ArrowRight } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';

import { EditorialStructuredData } from '@/components/marketing/editorial/editorial-structured-data';
import styles from '@/components/marketing/editorial/editorial.module.css';
import { TELEGRAM_PUBLIC_DOCUMENT } from '@/components/marketing/integrations/connector-public-documents';
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
          <MarketingContainer className="py-10 sm:py-14">
            <div className="flex items-center gap-4">
              <span className="grid size-12 place-items-center rounded-md border border-border bg-white">
                <Image src="/connectors/telegram.svg" alt="" width={28} height={28} />
              </span>
            </div>
            <div className="mt-8 grid items-end gap-10 grid-cols-[minmax(0,1fr)]">
              <h1 className={`${styles.displayTitle} max-w-[16ch]`}>{TELEGRAM_PAGE.title}</h1>
              <div>
                <p className="max-w-[44ch] text-base leading-relaxed text-fg-muted sm:text-lg">
                  {TELEGRAM_PAGE.summary}
                </p>
                <div className="mt-7 flex flex-wrap gap-3">
                  <StartFreeLink className="inline-flex min-h-12 items-center gap-2 rounded-sm bg-signal px-5 font-semibold text-signal-fg outline-none hover:brightness-95 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2" />
                  <PublicSessionBranch
                    signedOut={null}
                    signedIn={
                      <Link
                        href={TELEGRAM_PAGE.setupHref}
                        className="inline-flex min-h-12 items-center gap-2 rounded-sm border border-border px-5 font-semibold outline-none hover:bg-surface focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {TELEGRAM_PAGE.setupLabel}
                        <ArrowRight aria-hidden="true" className="size-4" />
                      </Link>
                    }
                  />
                </div>
              </div>
            </div>
          </MarketingContainer>
        </section>

        <section className="border-b border-border bg-surface/45">
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
