import { EditorialStructuredData } from '@/components/marketing/editorial/editorial-structured-data';
import styles from '@/components/marketing/editorial/editorial.module.css';
import { MarketingContainer } from '@/components/marketing/marketing-layout';
import { MarketingProductScreenshot } from '@/components/marketing/product-screenshot';
import { PRODUCT_TOUR } from '@/components/marketing/product-tour/content';
import { MarketingCtaBand } from '@/components/marketing/start-free-cta';
import { PRODUCT_TOUR_DOCUMENT } from '@/components/marketing/use-cases/public-documents';
import { buildPublicStructuredData } from '@/lib/public-site';
import { getSiteUrl } from '@/lib/site-url';

export function ProductTourPage() {
  return (
    <main id="main" tabIndex={-1} data-product-tour>
      <EditorialStructuredData
        data={buildPublicStructuredData(PRODUCT_TOUR_DOCUMENT, getSiteUrl())}
      />
      <header className="border-b border-border">
        <MarketingContainer className="py-16 sm:py-24 lg:py-28">
          <h1 className={styles.displayTitle}>{PRODUCT_TOUR.title}</h1>
          <p className="mt-7 max-w-2xl text-lg leading-8 text-fg-muted sm:text-xl">
            {PRODUCT_TOUR.summary}
          </p>
        </MarketingContainer>
      </header>

      <ol className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
        {PRODUCT_TOUR.steps.map((step, index) => (
          <li
            key={step.file}
            className="grid gap-8 border-b border-border py-14 first:pt-0 last:border-b-0 last:pb-0 lg:grid-cols-[13rem_minmax(0,1fr)]"
            data-tour-step={step.index}
          >
            <div>
              <p className="font-mono text-[0.68rem] tracking-[0.14em] text-signal uppercase">
                Step {step.index}
              </p>
              <h2 className="mt-4 text-2xl font-semibold tracking-[-0.035em] sm:text-3xl">
                {step.headline}
              </h2>
              <p className="mt-4 text-sm leading-7 text-fg-muted sm:text-base">{step.caption}</p>
            </div>
            <div className="grid gap-4">
              <div className={step.mobileFile ? 'hidden md:block' : undefined}>
                <MarketingProductScreenshot
                  file={step.file}
                  alt={step.alt}
                  caption={step.caption}
                  reshoot={step.reshoot}
                  priority={index === 0}
                />
              </div>
              {step.mobileFile ? (
                <div className="md:hidden">
                  <MarketingProductScreenshot
                    file={step.mobileFile}
                    alt={step.alt}
                    caption={step.caption}
                    reshoot={step.reshoot}
                    frame="portrait"
                  />
                </div>
              ) : null}
            </div>
          </li>
        ))}
      </ol>

      <MarketingCtaBand
        title={PRODUCT_TOUR.closingTitle}
        body={PRODUCT_TOUR.closingBody}
        firstRun
      />
    </main>
  );
}
