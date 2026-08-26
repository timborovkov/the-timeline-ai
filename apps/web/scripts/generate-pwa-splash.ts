import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';

import {
  APP_MARK_SHAPES,
  APP_MARK_VIEWBOX,
  appleSplashPath,
  appleSplashPixelSizes,
  PWA_BACKGROUND_COLOR,
  PWA_FOREGROUND_COLOR,
  PWA_SIGNAL_COLOR,
} from '../src/lib/pwa-splash';

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const MARK_RATIO = 0.22;
const COLOR_FG = 1;
const COLOR_SIGNAL = 2;

const splashDir = resolve(dirname(fileURLToPath(import.meta.url)), '../public/splash');

function hexToRgb(hex: string): Buffer {
  return Buffer.from([
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ]);
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBuffer = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])) >>> 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function fillRect(
  pixels: Uint8Array,
  imageWidth: number,
  imageHeight: number,
  x: number,
  y: number,
  width: number,
  height: number,
  color: number,
) {
  const x0 = Math.max(0, Math.round(x));
  const y0 = Math.max(0, Math.round(y));
  const x1 = Math.min(imageWidth, Math.round(x + width));
  const y1 = Math.min(imageHeight, Math.round(y + height));
  for (let row = y0; row < y1; row += 1) {
    const start = row * imageWidth + x0;
    pixels.fill(color, start, row * imageWidth + x1);
  }
}

function encodeIndexedPng(width: number, height: number, pixels: Uint8Array): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 3;
  const palette = Buffer.concat([
    hexToRgb(PWA_BACKGROUND_COLOR),
    hexToRgb(PWA_FOREGROUND_COLOR),
    hexToRgb(PWA_SIGNAL_COLOR),
  ]);
  const scanlines = Buffer.alloc(height * (width + 1));
  for (let row = 0; row < height; row += 1) {
    const dest = row * (width + 1);
    scanlines[dest] = 0;
    scanlines.set(pixels.subarray(row * width, (row + 1) * width), dest + 1);
  }
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', ihdr),
    pngChunk('PLTE', palette),
    pngChunk('IDAT', deflateSync(scanlines, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function renderSplash(width: number, height: number): Buffer {
  const pixels = new Uint8Array(width * height);
  const markSize = Math.round(Math.min(width, height) * MARK_RATIO);
  const originX = (width - markSize) / 2;
  const originY = (height - markSize) / 2;
  const scale = markSize / APP_MARK_VIEWBOX;

  for (const shape of APP_MARK_SHAPES) {
    fillRect(
      pixels,
      width,
      height,
      originX + shape.x * scale,
      originY + shape.y * scale,
      shape.width * scale,
      shape.height * scale,
      shape.fill === 'signal' ? COLOR_SIGNAL : COLOR_FG,
    );
  }

  return encodeIndexedPng(width, height, pixels);
}

mkdirSync(splashDir, { recursive: true });

for (const { width, height } of appleSplashPixelSizes()) {
  const fileName = appleSplashPath(width, height).slice('/splash/'.length);
  writeFileSync(resolve(splashDir, fileName), renderSplash(width, height));
}

console.log(`Wrote ${appleSplashPixelSizes().length} splash images to ${splashDir}`);
