/**
 * Qdrant collection storage layout and search-quantization defaults.
 *
 * New collections store original vectors and payloads on disk and keep an
 * int8 quantized copy in RAM. Binary quantization is opt-in via
 * `QDRANT_QUANTIZATION=binary`. Existing collections are never mutated —
 * operators copy points into a new collection, then switch
 * `QDRANT_COLLECTION`.
 */

export const QDRANT_SCALAR_QUANTILE = 0.99;
export const DEFAULT_SCALAR_OVERSAMPLING = 2;
export const DEFAULT_BINARY_OVERSAMPLING = 4;

export type QdrantQuantizationKind = 'scalar' | 'binary';

export interface QdrantQuantizationSettings {
  kind: QdrantQuantizationKind;
  rescore: boolean;
  oversampling: number;
}

export interface QdrantQuantizationEnv {
  QDRANT_QUANTIZATION: QdrantQuantizationKind;
  QDRANT_QUANTIZATION_RESCORE: boolean;
  QDRANT_QUANTIZATION_OVERSAMPLING?: number | undefined;
}

export function qdrantQuantizationFromEnv(env: QdrantQuantizationEnv): QdrantQuantizationSettings {
  const kind = env.QDRANT_QUANTIZATION;
  return {
    kind,
    rescore: env.QDRANT_QUANTIZATION_RESCORE,
    oversampling:
      env.QDRANT_QUANTIZATION_OVERSAMPLING ??
      (kind === 'binary' ? DEFAULT_BINARY_OVERSAMPLING : DEFAULT_SCALAR_OVERSAMPLING),
  };
}

function qdrantQuantizationConfig(kind: QdrantQuantizationKind): Record<string, unknown> {
  if (kind === 'binary') {
    return { binary: { always_ram: true } };
  }
  return {
    scalar: {
      type: 'int8',
      quantile: QDRANT_SCALAR_QUANTILE,
      always_ram: true,
    },
  };
}

export function qdrantCollectionCreateBody(
  vectorSize: number,
  kind: QdrantQuantizationKind = 'scalar',
): Record<string, unknown> {
  return {
    vectors: { size: vectorSize, distance: 'Cosine', on_disk: true },
    quantization_config: qdrantQuantizationConfig(kind),
    on_disk_payload: true,
  };
}

export function qdrantSearchQuantizationParams(
  settings: Pick<QdrantQuantizationSettings, 'rescore' | 'oversampling'>,
): Record<string, unknown> {
  return {
    quantization: {
      rescore: settings.rescore,
      oversampling: settings.oversampling,
    },
  };
}
