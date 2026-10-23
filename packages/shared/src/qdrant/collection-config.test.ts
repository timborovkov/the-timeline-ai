import { describe, expect, it } from 'vitest';

import {
  DEFAULT_BINARY_OVERSAMPLING,
  DEFAULT_SCALAR_OVERSAMPLING,
  QDRANT_EXACT_SEARCH_PARAMS,
  QDRANT_SCALAR_QUANTILE,
  assertCollectionMatchesCreateBody,
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

  it('exact recall baseline ignores quantized distances', () => {
    expect(QDRANT_EXACT_SEARCH_PARAMS).toEqual({
      exact: true,
      quantization: { ignore: true },
    });
  });

  it('accepts an existing collection that already has the create-body layout', () => {
    const expected = qdrantCollectionCreateBody(1536);
    expect(() => {
      assertCollectionMatchesCreateBody(
        {
          result: {
            config: {
              params: {
                on_disk_payload: true,
                vectors: { size: 1536, distance: 'Cosine', on_disk: true, extra: 'ok' },
              },
              quantization_config: {
                scalar: { type: 'int8', quantile: 0.99, always_ram: true, extra: true },
              },
            },
          },
        },
        expected,
      );
    }).not.toThrow();
  });

  it('rejects a leftover in-RAM collection as a migration target', () => {
    const expected = qdrantCollectionCreateBody(1536);
    expect(() => {
      assertCollectionMatchesCreateBody(
        {
          result: {
            config: {
              params: {
                on_disk_payload: false,
                vectors: { size: 1536, distance: 'Cosine', on_disk: false },
              },
            },
          },
        },
        expected,
      );
    }).toThrow(/on_disk/);
  });
});
