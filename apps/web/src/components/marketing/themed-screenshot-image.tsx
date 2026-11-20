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
  sizes,
  revisions,
}: {
  file: string;
  alt: string;
  portrait: boolean;
  priority: boolean;
  sizes?: string;
  revisions: { light: string; dark: string };
}) {
  const { resolvedTheme } = useTheme();
  const mounted = useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
  // The server cannot know the saved preference. Keep the reserved loading frame
  // until hydration rather than preloading a possibly wrong theme.
  if (!mounted || (resolvedTheme !== 'light' && resolvedTheme !== 'dark')) return null;
  const src = `${PRODUCT_SCREENSHOT_DIR}/${marketingScreenshotVariants(file)[resolvedTheme]}?v=${revisions[resolvedTheme]}`;

  return (
    <Image
      key={src}
      src={src}
      alt={alt}
      fill
      loading={priority ? 'eager' : 'lazy'}
      fetchPriority={priority ? 'high' : undefined}
      sizes={
        sizes ??
        (portrait ? '(min-width: 384px) 384px, 100vw' : '(min-width: 1152px) 1152px, 100vw')
      }
      className={cn('z-[1]', portrait ? 'object-contain object-top' : 'object-cover object-top')}
    />
  );
}
