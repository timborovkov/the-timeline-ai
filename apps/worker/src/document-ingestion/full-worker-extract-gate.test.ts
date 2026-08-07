import { describe, expect, it } from 'vitest';

import {
  assertProductionFullWorkerSkipsDocumentExtract,
  shouldStartDocumentExtractOnFullWorker,
} from '#src/document-ingestion/full-worker-extract-gate.js';

describe('assertProductionFullWorkerSkipsDocumentExtract', () => {
  it('throws when production full worker still has extract enabled', () => {
    expect(() => {
      assertProductionFullWorkerSkipsDocumentExtract({
        NODE_ENV: 'production',
        DOCUMENT_EXTRACT_ENABLED: true,
      });
    }).toThrow(/DOCUMENT_EXTRACT_ENABLED must be false on production full/);
  });

  it('allows production when extract is disabled', () => {
    expect(() => {
      assertProductionFullWorkerSkipsDocumentExtract({
        NODE_ENV: 'production',
        DOCUMENT_EXTRACT_ENABLED: false,
      });
    }).not.toThrow();
  });

  it('allows non-production even when extract is enabled', () => {
    expect(() => {
      assertProductionFullWorkerSkipsDocumentExtract({
        NODE_ENV: 'development',
        DOCUMENT_EXTRACT_ENABLED: true,
      });
    }).not.toThrow();
  });
});

describe('shouldStartDocumentExtractOnFullWorker', () => {
  it('never starts on production', () => {
    expect(
      shouldStartDocumentExtractOnFullWorker({
        NODE_ENV: 'production',
        DOCUMENT_EXTRACT_ENABLED: false,
        DAYTONA_API_KEY: 'dtn',
        DOCUMENT_EXTRACT_ALLOW_INPROCESS: false,
      }),
    ).toBe(false);
  });

  it('starts in development when Daytona is configured', () => {
    expect(
      shouldStartDocumentExtractOnFullWorker({
        NODE_ENV: 'development',
        DOCUMENT_EXTRACT_ENABLED: true,
        DAYTONA_API_KEY: 'dtn',
        DOCUMENT_EXTRACT_ALLOW_INPROCESS: false,
      }),
    ).toBe(true);
  });

  it('skips in development without Daytona or in-process escape hatch', () => {
    expect(
      shouldStartDocumentExtractOnFullWorker({
        NODE_ENV: 'development',
        DOCUMENT_EXTRACT_ENABLED: true,
        DOCUMENT_EXTRACT_ALLOW_INPROCESS: false,
      }),
    ).toBe(false);
  });
});
