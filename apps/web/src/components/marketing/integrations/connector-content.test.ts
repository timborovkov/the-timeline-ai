import { describe, expect, it } from 'vitest';

import {
  CONNECTOR_DIRECTORY_SUMMARY,
  CONNECTOR_SLUGS,
  CONNECTORS,
  findConnector,
  INDEXABLE_CONNECTOR_ROUTES,
} from '@/components/marketing/integrations/connector-content';

describe('connector content manifest', () => {
  it('exports exactly the six implemented native connector routes for public indexing', () => {
    expect(CONNECTORS.map((connector) => connector.slug)).toEqual(CONNECTOR_SLUGS);
    expect(INDEXABLE_CONNECTOR_ROUTES).toHaveLength(6);
    expect(new Set(INDEXABLE_CONNECTOR_ROUTES.map((route) => route.indexable))).toEqual(
      new Set([true]),
    );
    expect(new Set(INDEXABLE_CONNECTOR_ROUTES.map((route) => route.capability))).toEqual(
      new Set(['native']),
    );
    expect(INDEXABLE_CONNECTOR_ROUTES.map((route) => route.path)).toEqual([
      '/integrations/slack',
      '/integrations/github',
      '/integrations/linear',
      '/integrations/google-drive',
      '/integrations/monday',
      '/integrations/sentry',
    ]);
  });

  it('keeps MCP and planned tiers out of the canonical connector route export', () => {
    const serializedRoutes = JSON.stringify(INDEXABLE_CONNECTOR_ROUTES);
    expect(serializedRoutes).not.toContain('notion');
    expect(serializedRoutes).not.toContain('jira');
    expect(CONNECTOR_DIRECTORY_SUMMARY.mcpAccess).toContain('Notion');
    expect(CONNECTOR_DIRECTORY_SUMMARY.planned.indexable).toBe(false);
  });

  it('requires curated provider-specific substance on every native page', () => {
    for (const connector of CONNECTORS) {
      expect(connector.capability).toBe('Native integration');
      expect(connector.lastReviewed).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
      expect(connector.diagram.records).toHaveLength(3);
      expect(connector.diagram.citations).toHaveLength(3);
      expect(connector.exampleQuestions.length).toBeGreaterThanOrEqual(4);
      expect(connector.capturedRecords.length).toBeGreaterThanOrEqual(6);
      expect(connector.recipes).toHaveLength(3);
      expect(connector.setup.length).toBeGreaterThanOrEqual(4);
      expect(connector.permissions.length).toBeGreaterThanOrEqual(4);
      expect(connector.limitations.length).toBeGreaterThanOrEqual(3);
      expect(connector.faqs).toHaveLength(4);
      expect(connector.captureStatement).toContain('Timeline');
      expect(connector.providerStatement).toContain(connector.name);
    }
  });

  it('resolves known connectors and rejects non-published slugs', () => {
    expect(findConnector('google-drive')?.providerId).toBe('google_drive');
    expect(findConnector('notion')).toBeUndefined();
    expect(findConnector('planned-slack-alternative')).toBeUndefined();
  });

  it('keeps Google Drive claims inside the implemented change-feed boundary', () => {
    const drive = findConnector('google-drive');
    if (!drive) throw new Error('expected Google Drive connector');

    const promotedClaims = JSON.stringify({
      hero: drive.hero,
      intro: drive.intro,
      seoDescription: drive.seoDescription,
      captureStatement: drive.captureStatement,
      diagram: drive.diagram,
      exampleQuestions: drive.exampleQuestions,
      scenario: drive.scenario,
      capturedRecords: drive.capturedRecords,
    });
    const publicClaims = JSON.stringify(drive);

    expect(promotedClaims).not.toMatch(/Drive comments|selected folders|specific folders/iu);
    expect(publicClaims).toContain('My Drive root');
    expect(publicClaims).toContain('shared drives');
    expect(publicClaims).toContain('current changes cursor');
    expect(publicClaims).toContain('does not ingest Drive comments or Activity history');
    expect(publicClaims).not.toContain(
      'A team receives changes only from the My Drive root or shared drives',
    );
    expect(publicClaims).toContain('Drive removal tombstones do not include parent information');
    expect(publicClaims).toContain('even when that area was not activated');
  });
});
