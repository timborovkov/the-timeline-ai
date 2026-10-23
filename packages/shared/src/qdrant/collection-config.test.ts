import { describe, expect, it } from 'vitest';

import {
  DEFAULT_BINARY_OVERSAMPLING,
  DEFAULT_SCALAR_OVERSAMPLING,
  QDRANT_SCALAR_QUANTILE,
  qdrantCollectionCreateBody,
  qdrantQuantizationFromEnv,
  qdrantSearchQuantizationParams,
} from '#src/qdrant/collection-config.js';

describe('qdrant collection storage layout', () => {
  it('creates on-disk cosine vectors with scalar int8 quantization by default', () => {
    expect(qdrantCollectionCreateBody(1536)).toEqual({
      vectors: { size: 1536, distance: 'Cosine', on_disk: true },
      quantization_config: {
        scalar: { type: 'int8', quantile: QDRANT_SCALAR_QUANTILE, always_ram: true },
      },
      on_disk_payload: true,
    });
  });

  it('uses binary quantization when configured', () => {
    expect(qdrantCollectionCreateBody(1536, 'binary')).toEqual({
      vectors: { size: 1536, distance: 'Cosine', on_disk: true },
      quantization_config: { binary: { always_ram: true } },
      on_disk_payload: true,
    });
  });

  it('defaults oversampling to 2 for scalar and 4 for binary', () => {
    expect(
      qdrantQuantizationFromEnv({
        QDRANT_QUANTIZATION: 'scalar',
        QDRANT_QUANTIZATION_RESCORE: true,
      }),
    ).toEqual({
      kind: 'scalar',
      rescore: true,
      oversampling: DEFAULT_SCALAR_OVERSAMPLING,
    });
    expect(
      qdrantQuantizationFromEnv({
        QDRANT_QUANTIZATION: 'binary',
        QDRANT_QUANTIZATION_RESCORE: true,
      }).oversampling,
    ).toBe(DEFAULT_BINARY_OVERSAMPLING);
    expect(
      qdrantQuantizationFromEnv({
        QDRANT_QUANTIZATION: 'binary',
        QDRANT_QUANTIZATION_RESCORE: false,
        QDRANT_QUANTIZATION_OVERSAMPLING: 3,
      }),
    ).toEqual({ kind: 'binary', rescore: false, oversampling: 3 });
  });

  it('sends quantization rescore search params', () => {
    expect(qdrantSearchQuantizationParams({ rescore: true, oversampling: 2 })).toEqual({
      quantization: { rescore: true, oversampling: 2 },
    });
  });
});
