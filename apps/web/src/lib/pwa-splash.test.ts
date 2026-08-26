import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  APP_MARK_SHAPES,
  APPLE_SPLASH_DEVICES,
  appleSplashPath,
  appleSplashPixelSizes,
  appleStartupImages,
  appleWebApp,
  PWA_BACKGROUND_COLOR,
  pwaViewport,
} from '@/lib/pwa-splash';

const webRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');
const splashDir = join(webRoot, 'public/splash');
const iconSvg = readFileSync(join(webRoot, 'src/app/icon.svg'), 'utf8');

function pngSize(path: string): { width: number; height: number } {
  const bytes = readFileSync(path);
  expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

describe('PWA splash screens', () => {
  it('keeps the launch mark aligned with the app icon', () => {
    expect(iconSvg).toContain('viewBox="0 0 54 54"');
    expect(iconSvg).toContain(`fill="${PWA_BACKGROUND_COLOR}"`);
    for (const shape of APP_MARK_SHAPES) {
      expect(iconSvg).toMatch(
        new RegExp(
          `x="${shape.x}"\\s+y="${shape.y}"\\s+width="${shape.width}"\\s+height="${shape.height}"`,
        ),
      );
    }
  });

  it('uses integer CSS points for every iOS startup image', () => {
    for (const device of APPLE_SPLASH_DEVICES) {
      expect(device.width % device.scaleFactor).toBe(0);
      expect(device.height % device.scaleFactor).toBe(0);
    }
  });

  it('emits portrait and landscape apple-touch startup images', () => {
    expect(appleWebApp.capable).toBe(true);
    expect(appleWebApp.statusBarStyle).toBe('black');
    expect(appleStartupImages).toHaveLength(APPLE_SPLASH_DEVICES.length * 2);
    expect(pwaViewport.viewportFit).toBe('cover');
    expect(pwaViewport.themeColor).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          media: '(prefers-color-scheme: dark)',
          color: PWA_BACKGROUND_COLOR,
        }),
      ]),
    );

    for (const device of APPLE_SPLASH_DEVICES) {
      const cssWidth = device.width / device.scaleFactor;
      const cssHeight = device.height / device.scaleFactor;
      expect(appleStartupImages).toEqual(
        expect.arrayContaining([
          {
            url: appleSplashPath(device.width, device.height),
            media: `(device-width: ${cssWidth}px) and (device-height: ${cssHeight}px) and (-webkit-device-pixel-ratio: ${device.scaleFactor}) and (orientation: portrait)`,
          },
          {
            url: appleSplashPath(device.height, device.width),
            media: `(device-width: ${cssHeight}px) and (device-height: ${cssWidth}px) and (-webkit-device-pixel-ratio: ${device.scaleFactor}) and (orientation: landscape)`,
          },
        ]),
      );
    }
  });

  it('ships a PNG for every startup image size and no extras', () => {
    const expected = new Set(
      appleSplashPixelSizes().map(({ width, height }) => `apple-${width}-${height}.png`),
    );
    const actual = new Set(readdirSync(splashDir).filter((name) => name.endsWith('.png')));
    expect(actual).toEqual(expected);

    for (const { width, height } of appleSplashPixelSizes()) {
      expect(pngSize(join(splashDir, `apple-${width}-${height}.png`))).toEqual({ width, height });
    }
  });
});
