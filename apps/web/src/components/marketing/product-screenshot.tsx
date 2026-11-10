import { existsSync } from 'node:fs';
import { join } from 'node:path';

import Image from 'next/image';

import type {
  MarketingScreenshotCallout,
  MarketingScreenshotFrame,
  MarketingScreenshotSlot,
} from '@/components/marketing/screenshot-slot';

import { FICTIONAL_EXAMPLE_LABEL, PRODUCT_SCREENSHOT_DIR } from '@/components/marketing/copy';
import { cn } from '@/lib/utils';

const PUBLIC_ROOTS = [
  join(process.cwd(), 'public'),
  join(process.cwd(), 'apps/web/public'),
] as const;

function marketingScreenshotFileExists(file: string): boolean {
  return PUBLIC_ROOTS.some((root) => existsSync(join(root, 'marketing/screenshots', file)));
}

export function MarketingProductScreenshot({
  file,
  alt,
  caption,
  reshoot,
  priority = false,
  frame = 'landscape',
  callouts,
}: {
  file: string;
  alt: string;
  caption: string;
  reshoot?: string;
  priority?: boolean;
  frame?: MarketingScreenshotFrame;
  callouts?: readonly MarketingScreenshotCallout[];
}) {
  const src = `${PRODUCT_SCREENSHOT_DIR}/${file}`;
  const present = marketingScreenshotFileExists(file);
  const portrait = frame === 'portrait';

  return (
    <figure
      className="overflow-hidden rounded-md border border-border bg-surface"
      data-screenshot-file={file}
      data-screenshot-frame={frame}
      data-screenshot-present={present ? 'true' : 'false'}
    >
      <div
        className={cn(
          'relative bg-surface-2',
          portrait ? 'mx-auto aspect-[390/844] w-full max-w-sm' : 'aspect-[16/10]',
        )}
      >
        {present ? (
          <>
            <div
              data-screenshot-pending
              aria-hidden="true"
              className="absolute inset-0 grid place-items-center px-6 text-center"
            >
              <p className="font-mono text-[0.65rem] tracking-[0.14em] text-fg-muted uppercase">
                Loading screenshot
              </p>
            </div>
            <Image
              src={src}
              alt={alt}
              fill
              priority={priority}
              unoptimized
              sizes={
                portrait ? '(max-width: 767px) 24rem, 100vw' : '(min-width: 1024px) 72rem, 100vw'
              }
              className={cn(
                'z-[1]',
                portrait ? 'object-contain object-top' : 'object-cover object-top',
              )}
            />
          </>
        ) : (
          <div
            role="img"
            aria-label={`${alt}. Screenshot placeholder for ${file}.`}
            className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center"
          >
            <p className="font-mono text-[0.65rem] tracking-[0.14em] text-signal uppercase">
              Screenshot placeholder
            </p>
            <p className="max-w-xl font-mono text-sm text-fg">{file}</p>
            <p className="max-w-lg text-sm leading-6 text-fg-muted">
              Drop the named file into{' '}
              <code className="font-mono text-xs">apps/web/public/marketing/screenshots</code> to
              swap this slot. Reshoot after the citation redesign and seed update.
            </p>
            {reshoot ? <p className="max-w-lg text-xs leading-5 text-fg-dim">{reshoot}</p> : null}
          </div>
        )}
      </div>
      {callouts && callouts.length > 0 ? (
        <ol
          className="grid gap-4 border-t border-border px-5 py-4 sm:grid-cols-3 sm:px-6"
          data-screenshot-callouts
        >
          {callouts.map((callout) => (
            <li key={callout.label} className="min-w-0">
              <p className="font-mono text-[0.62rem] tracking-[0.12em] text-signal uppercase">
                {callout.label}
              </p>
              <p className="mt-2 text-sm leading-6 text-fg">{callout.detail}</p>
            </li>
          ))}
        </ol>
      ) : null}
      <figcaption className="space-y-2 border-t border-border px-5 py-4 sm:px-6">
        <p className="text-sm leading-6 text-fg-muted">{caption}</p>
        <p className="font-mono text-[0.62rem] tracking-[0.12em] text-fg-dim uppercase">
          {FICTIONAL_EXAMPLE_LABEL}
        </p>
      </figcaption>
    </figure>
  );
}

export function MarketingScreenshotBlock({
  shots,
  priorityFirst = false,
}: {
  shots: readonly MarketingScreenshotSlot[];
  priorityFirst?: boolean;
}) {
  if (shots.length === 0) return null;
  return (
    <div className="grid gap-6">
      {shots.map((shot, index) => (
        <MarketingProductScreenshot
          key={shot.file}
          file={shot.file}
          alt={shot.alt}
          caption={shot.caption}
          reshoot={shot.reshoot}
          frame={shot.frame}
          callouts={shot.callouts}
          priority={priorityFirst && index === 0}
        />
      ))}
    </div>
  );
}
