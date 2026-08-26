import type { Metadata, Viewport } from 'next';

/** Matches the home-screen icon field and Android Chrome splash. */
export const PWA_BACKGROUND_COLOR = '#0a0e0d';
export const PWA_FOREGROUND_COLOR = '#f5f5f5';
export const PWA_SIGNAL_COLOR = '#b5ea4a';

/** Light `--bg` (`oklch(0.99 0.002 240)`) for browser chrome before install. */
export const PWA_LIGHT_THEME_COLOR = '#fbfcfc';

/** Matches `apps/web/src/app/icon.svg` viewBox. */
export const APP_MARK_VIEWBOX = 54;

export const APP_MARK_SHAPES = [
  { x: 3, y: 9, width: 38, height: 6, fill: 'fg' },
  { x: 3, y: 19, width: 27, height: 6, fill: 'fg' },
  { x: 3, y: 29, width: 38, height: 6, fill: 'fg' },
  { x: 3, y: 39, width: 32, height: 6, fill: 'fg' },
  { x: 45, y: 29, width: 6, height: 6, fill: 'signal' },
] as const;

export interface AppleSplashDevice {
  /** Physical portrait pixels. */
  width: number;
  height: number;
  scaleFactor: 2 | 3;
}

/**
 * Unique portrait raster sizes iOS matches for `apple-touch-startup-image`.
 * CSS points are width/scaleFactor × height/scaleFactor.
 */
export const APPLE_SPLASH_DEVICES: readonly AppleSplashDevice[] = [
  { width: 640, height: 1136, scaleFactor: 2 },
  { width: 750, height: 1334, scaleFactor: 2 },
  { width: 828, height: 1792, scaleFactor: 2 },
  { width: 1125, height: 2436, scaleFactor: 3 },
  { width: 1170, height: 2532, scaleFactor: 3 },
  { width: 1179, height: 2556, scaleFactor: 3 },
  { width: 1206, height: 2622, scaleFactor: 3 },
  { width: 1242, height: 2208, scaleFactor: 3 },
  { width: 1242, height: 2688, scaleFactor: 3 },
  { width: 1284, height: 2778, scaleFactor: 3 },
  { width: 1290, height: 2796, scaleFactor: 3 },
  { width: 1320, height: 2868, scaleFactor: 3 },
  { width: 1488, height: 2266, scaleFactor: 2 },
  { width: 1536, height: 2048, scaleFactor: 2 },
  { width: 1620, height: 2160, scaleFactor: 2 },
  { width: 1640, height: 2360, scaleFactor: 2 },
  { width: 1668, height: 2224, scaleFactor: 2 },
  { width: 1668, height: 2388, scaleFactor: 2 },
  { width: 1668, height: 2420, scaleFactor: 2 },
  { width: 2048, height: 2732, scaleFactor: 2 },
  { width: 2064, height: 2752, scaleFactor: 2 },
];

export function appleSplashPath(width: number, height: number): string {
  return `/splash/apple-${width}-${height}.png`;
}

export function appleSplashPixelSizes(): Array<{ width: number; height: number }> {
  return APPLE_SPLASH_DEVICES.flatMap((device) => [
    { width: device.width, height: device.height },
    { width: device.height, height: device.width },
  ]);
}

function appleSplashMedia(
  deviceWidth: number,
  deviceHeight: number,
  scaleFactor: 2 | 3,
  orientation: 'portrait' | 'landscape',
): string {
  return `(device-width: ${deviceWidth}px) and (device-height: ${deviceHeight}px) and (-webkit-device-pixel-ratio: ${scaleFactor}) and (orientation: ${orientation})`;
}

export const appleStartupImages: NonNullable<NonNullable<Metadata['appleWebApp']>['startupImage']> =
  APPLE_SPLASH_DEVICES.flatMap((device) => {
    const cssWidth = device.width / device.scaleFactor;
    const cssHeight = device.height / device.scaleFactor;
    return [
      {
        url: appleSplashPath(device.width, device.height),
        media: appleSplashMedia(cssWidth, cssHeight, device.scaleFactor, 'portrait'),
      },
      {
        url: appleSplashPath(device.height, device.width),
        media: appleSplashMedia(cssHeight, cssWidth, device.scaleFactor, 'landscape'),
      },
    ];
  });

export const appleWebApp = {
  capable: true,
  title: 'The Timeline',
  // Non-overlaying: black-translucent draws under the status bar without safe-area padding.
  statusBarStyle: 'black',
  startupImage: appleStartupImages,
} satisfies NonNullable<Metadata['appleWebApp']>;

export const pwaViewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: PWA_LIGHT_THEME_COLOR },
    { media: '(prefers-color-scheme: dark)', color: PWA_BACKGROUND_COLOR },
  ],
} satisfies Viewport;
