'use client';

import Image from 'next/image';
import { useTheme } from 'next-themes';
import { useSyncExternalStore } from 'react';

import { PRODUCT_SCREENSHOT_DIR } from '@/components/marketing/copy';
import { marketingScreenshotVariants } from '@/components/marketing/screenshot-slot';
import { cn } from '@/lib/utils';

const subscribe = () => () => undefined;
const clientSnapshot = () => true;
const serverSnapshot = () => false;

export function ThemedScreenshotImage({
  file,
  alt,
  portrait,
  priority,
  expandable = false,
}: {
  file: string;
  alt: string;
  portrait: boolean;
  priority: boolean;
  expandable?: boolean;
}) {
  const { resolvedTheme } = useTheme();
  const mounted = useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
  // The server cannot know the saved preference. Keep the reserved loading frame
  // until hydration rather than preloading a possibly wrong theme.
  if (!mounted || (resolvedTheme !== 'light' && resolvedTheme !== 'dark')) return null;
  const src = `${PRODUCT_SCREENSHOT_DIR}/${marketingScreenshotVariants(file)[resolvedTheme]}`;

  const image = (
    <Image
      key={src}
      src={src}
      alt={alt}
      fill
      loading={priority ? 'eager' : 'lazy'}
      fetchPriority={priority ? 'high' : undefined}
      unoptimized
      sizes={portrait ? '(max-width: 767px) 24rem, 100vw' : '(min-width: 1024px) 72rem, 100vw'}
      className={cn('z-[1]', portrait ? 'object-contain object-top' : 'object-cover object-top')}
    />
  );
  return expandable ? (
    <a
      href={src}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Open full-size screenshot in a new tab: ${alt}`}
      className="absolute inset-0 z-[1] cursor-zoom-in focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-signal"
    >
      {image}
    </a>
  ) : (
    image
  );
}
