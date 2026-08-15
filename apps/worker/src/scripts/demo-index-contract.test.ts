import { describe, expect, it } from 'vitest';

import {
  assertDemoVectorIndexEnvironment,
  assertExpectedDemoVectorSources,
  buildDemoVectorJobs,
  type DemoVectorRows,
} from '#src/scripts/demo-index-contract.js';

const TEAM_ID = '20000000-0000-4000-8000-000000000001';

function rows(): DemoVectorRows {
  return {
    rawEvents: Array.from({ length: 4 }, (_, index) => ({ id: `event-${String(index)}` })),
    facts: Array.from({ length: 5 }, (_, index) => ({
      id: `fact-${String(index)}`,
      rawEventId: `event-${String(index % 4)}`,
    })),
    documentChunks: [{ id: 'document-chunk-0', versionId: 'document-version-0' }],
    meetingChunks: [{ id: 'meeting-chunk-0' }],
  };
}

describe('demo vector indexing contract', () => {
  it('fails closed on missing, invalid, or unapproved vector configuration', () => {
    const local = {
      nodeEnv: 'development',
      openRouterApiKey: 'dev-key',
      qdrantUrl: 'http://localhost:6333',
      allowDevSeed: undefined,
    };
    expect(() => assertDemoVectorIndexEnvironment(local)).not.toThrow();
    expect(() =>
      assertDemoVectorIndexEnvironment({ ...local, openRouterApiKey: undefined }),
    ).toThrow(/OPENROUTER_API_KEY/);
    expect(() => assertDemoVectorIndexEnvironment({ ...local, qdrantUrl: 'not-a-url' })).toThrow(
      /QDRANT_URL must be a valid URL/,
    );
    expect(() =>
      assertDemoVectorIndexEnvironment({ ...local, qdrantUrl: 'https://qdrant.example.com' }),
    ).toThrow(/Refusing to use non-local Qdrant host/);
    expect(() => assertDemoVectorIndexEnvironment({ ...local, nodeEnv: 'production' })).toThrow(
      /NODE_ENV=production/,
    );
  });

  it('builds production embed jobs for every required fixture source kind', () => {
    const fixtureRows = rows();
    expect(() => assertExpectedDemoVectorSources(fixtureRows)).not.toThrow();
    expect(buildDemoVectorJobs(TEAM_ID, fixtureRows)).toEqual([
      ...fixtureRows.rawEvents.map(({ id }) => ({
        scope: 'raw_event',
        rawEventId: id,
        teamId: TEAM_ID,
      })),
      ...fixtureRows.facts.map(({ id, rawEventId }) => ({
        scope: 'fact',
        factId: id,
        rawEventId,
        teamId: TEAM_ID,
      })),
      {
        scope: 'doc_chunk',
        documentChunkId: 'document-chunk-0',
        teamId: TEAM_ID,
      },
      {
        scope: 'meeting_chunk',
        meetingChunkId: 'meeting-chunk-0',
        teamId: TEAM_ID,
      },
    ]);
  });

  it('fails closed when any fixture source kind is incomplete', () => {
    const fixtureRows = rows();
    fixtureRows.documentChunks = [];
    expect(() => assertExpectedDemoVectorSources(fixtureRows)).toThrow(
      /documentChunks expected 1, found 0/,
    );
  });
});
