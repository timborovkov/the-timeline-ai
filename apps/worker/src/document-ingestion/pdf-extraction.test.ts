import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';

import {
  completeSandboxPageImages,
  extractPdfTextWithVisionFallback,
} from '#src/document-ingestion/pdf-extraction.js';

describe('extractPdfTextWithVisionFallback', () => {
  it('returns accepted sandbox text without calling vision', async () => {
    const extractFromMedia = () => {
      throw new Error('vision should not run');
    };
    const result = await extractPdfTextWithVisionFallback({
      body: Buffer.from('%PDF'),
      filename: 'scan.pdf',
      extractPdfSandbox: () =>
        Promise.resolve({
          text: 'enough text from anydoc about the quarterly report summary',
          method: 'anydoc',
          pageCount: 2,
          sparse: false,
          pageImages: [],
        }),
      extractFromMedia,
    });
    expect(result).toEqual({
      text: 'enough text from anydoc about the quarterly report summary',
    });
  });

  it('falls back to vision for sparse sandbox PDFs and forwards complete page images', async () => {
    const pageImages = [Buffer.from('png-1'), Buffer.from('png-2')];
    let visionInput: {
      mediaType: string;
      filename: string;
      pageImages?: Buffer[];
    } | null = null;
    const result = await extractPdfTextWithVisionFallback({
      body: Buffer.from('%PDF'),
      filename: 'scan.pdf',
      extractPdfSandbox: () =>
        Promise.resolve({
          text: 'short',
          method: 'anydoc',
          pageCount: 2,
          sparse: true,
          pageImages,
        }),
      extractFromMedia: (input) => {
        visionInput = {
          mediaType: input.mediaType,
          filename: input.filename,
          ...(input.pageImages ? { pageImages: input.pageImages } : {}),
        };
        return Promise.resolve({ text: 'OCR recovered the scanned contract amount' });
      },
    });
    expect(result).toEqual({ text: 'OCR recovered the scanned contract amount' });
    expect(visionInput).toEqual({
      mediaType: 'application/pdf',
      filename: 'scan.pdf',
      pageImages,
    });
    expect(
      completeSandboxPageImages({
        text: 'short',
        method: 'anydoc',
        pageCount: 2,
        sparse: true,
        pageImages,
      }),
    ).toEqual(pageImages);
  });
});
