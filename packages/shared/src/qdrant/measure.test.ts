import { describe, expect, it } from 'vitest';

import {
  collectionRamSnapshotFromInfo,
  parsePrometheusGauges,
  recallAtK,
} from '#src/qdrant/measure.js';

describe('qdrant RAM and recall helpers', () => {
  it('parses collection-labeled prometheus gauges and process memory', () => {
    const text = `
# HELP collection_memory Collection memory
collection_data_ram_size_bytes{collection="events"} 123456
collection_points_count{collection="events"} 12
app_memory_usage_bytes 999
other_metric{collection="other"} 1
`.trim();
    expect(parsePrometheusGauges(text, 'events')).toEqual({
      collection_data_ram_size_bytes: 123456,
      app_memory_usage_bytes: 999,
    });
  });

  it('reads on-disk and quantization flags from collection info', () => {
    const snapshot = collectionRamSnapshotFromInfo(
      'events_ondisk',
      {
        result: {
          points_count: 12,
          indexed_vectors_count: 12,
          segments_count: 1,
          config: {
            params: {
              on_disk_payload: true,
              vectors: { size: 4, distance: 'Cosine', on_disk: true },
            },
            quantization_config: { scalar: { type: 'int8' } },
          },
        },
      },
      'collection_data_ram_size_bytes{collection="events_ondisk"} 42\n',
    );
    expect(snapshot).toMatchObject({
      collection: 'events_ondisk',
      pointsCount: 12,
      vectorsOnDisk: true,
      onDiskPayload: true,
      quantization: 'scalar',
      metricBytes: { collection_data_ram_size_bytes: 42 },
    });
  });

  it('computes overlap-at-k against the baseline ranking', () => {
    expect(recallAtK(['a', 'b', 'c'], ['a', 'c', 'd'], 2)).toBe(0.5);
    expect(recallAtK(['a', 'b'], ['b', 'a'], 2)).toBe(1);
    expect(recallAtK([], ['a'], 10)).toBe(1);
  });
});
