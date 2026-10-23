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

/** Uncompressed recall baseline: full scan with quantized distances disabled. */
export const QDRANT_EXACT_SEARCH_PARAMS = {
  exact: true,
  quantization: { ignore: true },
} as const;

export interface CollectionStorageLayout {
  vectorSize: number | null;
  distance: string | null;
  vectorsOnDisk: boolean | null;
  onDiskPayload: boolean | null;
  quantization: Record<string, unknown> | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function nested(value: unknown, path: string[]): unknown {
  let current: unknown = value;
  for (const key of path) {
    const record = asRecord(current);
    if (!record) return undefined;
    current = record[key];
  }
  return current;
}

export function collectionStorageLayoutFromInfo(info: unknown): CollectionStorageLayout {
  const result = nested(info, ['result']) ?? info;
  const params = nested(result, ['config', 'params']);
  const vectors = asRecord(nested(params, ['vectors']));
  const quantization = asRecord(
    nested(result, ['config', 'quantization_config']) ?? nested(params, ['quantization_config']),
  );
  const size = vectors?.size;
  const distance = vectors?.distance;
  const onDisk = vectors?.on_disk;
  const onDiskPayload = nested(params, ['on_disk_payload']);
  return {
    vectorSize: typeof size === 'number' ? size : null,
    distance: typeof distance === 'string' ? distance : null,
    vectorsOnDisk: typeof onDisk === 'boolean' ? onDisk : null,
    onDiskPayload: typeof onDiskPayload === 'boolean' ? onDiskPayload : null,
    quantization,
  };
}

function requiredRecord(value: unknown, label: string): Record<string, unknown> {
  const record = asRecord(value);
  if (!record) throw new Error(`Qdrant target ${label} is missing`);
  return record;
}

function assertSubset(
  actual: Record<string, unknown>,
  expected: Record<string, unknown>,
  path: string,
): void {
  for (const [key, expectedValue] of Object.entries(expected)) {
    const actualValue = actual[key];
    const nextPath = `${path}.${key}`;
    if (expectedValue && typeof expectedValue === 'object' && !Array.isArray(expectedValue)) {
      assertSubset(
        requiredRecord(actualValue, nextPath),
        expectedValue as Record<string, unknown>,
        nextPath,
      );
      continue;
    }
    if (actualValue !== expectedValue) {
      throw new Error(
        `Qdrant target ${nextPath} is ${JSON.stringify(actualValue)}, expected ${JSON.stringify(expectedValue)}`,
      );
    }
  }
}

/**
 * Fail unless an existing collection already has the advertised on-disk +
 * quantized layout. Used before copy/cutover so a leftover in-RAM collection
 * cannot be treated as the migration target.
 */
export function assertCollectionMatchesCreateBody(
  info: unknown,
  expected: Record<string, unknown>,
): void {
  const layout = collectionStorageLayoutFromInfo(info);
  const expectedVectors = requiredRecord(expected.vectors, 'vectors');
  const actualVectors: Record<string, unknown> = {
    size: layout.vectorSize,
    distance: layout.distance,
    on_disk: layout.vectorsOnDisk,
  };
  assertSubset(actualVectors, expectedVectors, 'vectors');
  if (expected.on_disk_payload === true && layout.onDiskPayload !== true) {
    throw new Error(
      `Qdrant target on_disk_payload is ${JSON.stringify(layout.onDiskPayload)}, expected true`,
    );
  }
  const expectedQuantization = requiredRecord(expected.quantization_config, 'quantization_config');
  if (!layout.quantization) {
    throw new Error('Qdrant target quantization_config is missing');
  }
  assertSubset(layout.quantization, expectedQuantization, 'quantization_config');
}
