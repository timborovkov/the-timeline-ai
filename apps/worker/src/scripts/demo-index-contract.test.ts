import { describe, expect, it } from 'vitest';

import {
  assertDemoVectorIndexEnvironment,
  assertExpectedDemoVectorSources,
  buildDemoVectorJobs,
  DEMO_VECTOR_ID_FAMILIES,
  DEMO_VECTOR_SOURCE_MINIMUMS,
  type DemoVectorRows,
} from '#src/scripts/demo-index-contract.js';

const TEAM_ID = '20000000-0000-4000-8000-000000000001';

function padded(n: number): string {
  return n.toString(16).padStart(12, '0');
}

function familyIds(
  family: (typeof DEMO_VECTOR_ID_FAMILIES)[keyof typeof DEMO_VECTOR_ID_FAMILIES],
): { northstar: string[]; corpus: string[] } {
  return {
    northstar: Array.from(
      { length: family.northstarExact },
      (_, index) => `${family.northstarPrefix}0000-4000-8000-${padded(index + 1)}`,
    ),
    corpus: Array.from(
      { length: family.corpusMinimum },
      (_, index) => `${family.corpusPrefix}0000-4000-8000-${padded(index + 1)}`,
    ),
  };
}

function rows(): DemoVectorRows {
  const events = familyIds(DEMO_VECTOR_ID_FAMILIES.rawEvents);
  const facts = familyIds(DEMO_VECTOR_ID_FAMILIES.facts);
  const documentChunks = familyIds(DEMO_VECTOR_ID_FAMILIES.documentChunks);
  const meetingChunks = familyIds(DEMO_VECTOR_ID_FAMILIES.meetingChunks);
  return {
    rawEvents: [...events.northstar, ...events.corpus].map((id) => ({ id })),
    facts: [...facts.northstar, ...facts.corpus].map((id, index) => ({
      id,
      rawEventId: `event-${String(index % DEMO_VECTOR_SOURCE_MINIMUMS.rawEvents)}`,
    })),
    documentChunks: [...documentChunks.northstar, ...documentChunks.corpus].map((id) => ({
      id,
      versionId: `document-version-${id}`,
    })),
    meetingChunks: [...meetingChunks.northstar, ...meetingChunks.corpus].map((id) => ({ id })),
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
    expect(() => {
      assertDemoVectorIndexEnvironment(local);
    }).not.toThrow();
    expect(() => {
      assertDemoVectorIndexEnvironment({ ...local, openRouterApiKey: undefined });
    }).toThrow(/OPENROUTER_API_KEY/);
    expect(() => {
      assertDemoVectorIndexEnvironment({ ...local, qdrantUrl: 'not-a-url' });
    }).toThrow(/QDRANT_URL must be a valid URL/);
    expect(() => {
      assertDemoVectorIndexEnvironment({ ...local, qdrantUrl: 'https://qdrant.example.com' });
    }).toThrow(/Refusing to use non-local Qdrant host/);
    expect(() => {
      assertDemoVectorIndexEnvironment({ ...local, nodeEnv: 'production' });
    }).toThrow(/NODE_ENV=production/);
  });

  it('builds production embed jobs for every required fixture source kind', () => {
    const fixtureRows = rows();
    expect(() => {
      assertExpectedDemoVectorSources(fixtureRows);
    }).not.toThrow();
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
      ...fixtureRows.documentChunks.map(({ id }) => ({
        scope: 'doc_chunk' as const,
        documentChunkId: id,
        teamId: TEAM_ID,
      })),
      ...fixtureRows.meetingChunks.map(({ id }) => ({
        scope: 'meeting_chunk' as const,
        meetingChunkId: id,
        teamId: TEAM_ID,
      })),
    ]);
  });

  it('accepts larger fixture source sets than the Northstar minimum', () => {
    const fixtureRows = rows();
    fixtureRows.rawEvents.push({
      id: `${DEMO_VECTOR_ID_FAMILIES.rawEvents.corpusPrefix}0000-4000-8000-${padded(9000)}`,
    });
    expect(() => {
      assertExpectedDemoVectorSources(fixtureRows);
    }).not.toThrow();
  });

  it('fails closed when any fixture source kind is incomplete', () => {
    const fixtureRows = rows();
    fixtureRows.documentChunks = [];
    expect(() => {
      assertExpectedDemoVectorSources(fixtureRows);
    }).toThrow(/documentChunks expected at least 15, found 0/);
  });

  it('fails closed when Northstar vector ids are missing from a complete-looking corpus', () => {
    const fixtureRows = rows();
    fixtureRows.rawEvents = fixtureRows.rawEvents.filter((row) =>
      row.id.startsWith(DEMO_VECTOR_ID_FAMILIES.rawEvents.corpusPrefix),
    );
    expect(() => {
      assertExpectedDemoVectorSources(fixtureRows);
    }).toThrow(/rawEvents expected exactly 4 Northstar ids, found 0/);
  });

  it('fails closed when fixture-version rows use unexpected id families', () => {
    const fixtureRows = rows();
    fixtureRows.facts.push({
      id: 'aa110001-0000-4000-8000-000000000001',
      rawEventId: 'event-heavy',
    });
    expect(() => {
      assertExpectedDemoVectorSources(fixtureRows);
    }).toThrow(/unexpected facts ids/);
  });
});
