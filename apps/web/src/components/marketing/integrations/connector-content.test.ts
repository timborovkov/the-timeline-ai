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
    expect(CONNECTOR_DIRECTORY_SUMMARY.mcpAccess).not.toContain('Figma');
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

  it('keeps fixed dark provider marks legible on dark surfaces', () => {
    expect(
      CONNECTORS.filter((connector) => connector.lightLogoTileInDarkMode).map(
        (connector) => connector.slug,
      ),
    ).toEqual(['slack', 'github', 'sentry']);
  });

  it('resolves known connectors and rejects non-published slugs', () => {
    expect(findConnector('google-drive')?.providerId).toBe('google_drive');
    expect(findConnector('notion')).toBeUndefined();
    expect(findConnector('planned-slack-alternative')).toBeUndefined();
  });

  it('discloses the Slack incremental reconciliation window', () => {
    const slack = findConnector('slack');
    if (!slack) throw new Error('expected Slack connector');

    const limitations = slack.limitations.join(' ');
    expect(limitations).toContain('looks back 14 days');
    expect(limitations).toContain('new replies whose thread root is older than that window');
    expect(limitations).toContain('remain the first-observed snapshot');
    expect(limitations).toContain('first 2,000 replies returned');
    expect(limitations).toContain('replies beyond that cap remain absent');
    expect(limitations).toContain('at most 2,000 non-archived bot-visible channels');
    expect(slack.permissions.join(' ')).toContain(
      'does not intersect bot access with the authorizing person’s own channel membership',
    );
    expect(slack.faqs.map((faq) => faq.answer).join(' ')).toContain(
      'bot can retain access after that person leaves a channel',
    );
    expect(slack.capturedRecords).toContain(
      'First-observed reaction events with their initial count and user snapshot',
    );
  });

  it('discloses native provider history and reconciliation boundaries', () => {
    const github = findConnector('github');
    const linear = findConnector('linear');
    const monday = findConnector('monday');
    if (!github || !linear || !monday) throw new Error('expected native connector content');

    const githubClaims = JSON.stringify(github);
    expect(githubClaims).toContain('polls the repository default branch');
    expect(githubClaims).toContain('non-default-branch-only pushes rely on webhook delivery');
    expect(githubClaims).not.toContain('recover anything missed');
    expect(githubClaims).toContain(
      'Initial default-branch commit history is capped at 2,000 commits',
    );
    expect(githubClaims).toContain('2,000 pull requests per state');
    expect(githubClaims).toContain('2,000 review summaries per pull request');
    expect(githubClaims).toContain(
      'Issue and inline-review comment surfaces use a separate continuation',
    );
    expect(githubClaims).toContain('2,000 most recently updated repositories');

    expect(linear.limitations.join(' ')).toContain(
      'history begins when Timeline starts observing the selected team',
    );
    expect(linear.limitations.join(' ')).toContain(
      'move between Linear workflow states that normalize to the same Timeline bucket',
    );
    expect(linear.limitations.join(' ')).toContain('first 2,000 teams returned by the API');
    expect(monday.limitations.join(' ')).toContain(
      'Initial board activity-log backfill covers the preceding 30 days',
    );
    expect(monday.limitations.join(' ')).toContain('lag Monday.com by up to 24 hours');
    expect(monday.limitations.join(' ')).toContain('10,000 boards and 2,500 WorkDocs');
    expect(monday.limitations.join(' ')).toContain('WorkDoc refresh reads at most 10,000 blocks');
    expect(monday.limitations.join(' ')).toContain('does not persist a block-page continuation');
    expect(monday.limitations.join(' ')).toContain(
      'user-created board with that prefix can therefore be hidden',
    );
  });

  it('keeps Slack attachment claims inside the metadata-only boundary', () => {
    const slack = findConnector('slack');
    if (!slack) throw new Error('expected Slack connector');

    const claims = JSON.stringify(slack);
    expect(claims).toContain('file-share metadata');
    expect(claims).toContain('does not download or inspect attachment bodies');
    expect(slack.intro).not.toContain('threads, files, reactions');
    expect(slack.seoDescription).not.toContain('threads, files, reactions');
  });

  it('discloses GitHub App installation scope for organization selections', () => {
    const github = findConnector('github');
    if (!github) throw new Error('expected GitHub connector');

    const claims = JSON.stringify(github);
    expect(claims).toContain('installation covers every repository');
    expect(claims).toContain('excluded from a selected-repositories App installation');
    expect(claims).not.toContain(
      'Organization selection includes only repositories the connection owner and installed app can access',
    );
  });

  it('qualifies Sentry recovery and lifecycle timestamps', () => {
    const sentry = findConnector('sentry');
    if (!sentry) throw new Error('expected Sentry connector');

    const claims = JSON.stringify(sentry);
    expect(claims).toContain('cannot recover a missed alert or deployment delivery');
    expect(claims).toContain(
      'A missed resolve or ignore webhook for a quiet issue may not be recovered',
    );
    expect(claims).toContain('repeated closed transition does not create a new lifecycle row');
    expect(claims).toContain('one immutable deployed key per release');
    expect(claims).toContain('later deployment does not create a new row');
    expect(claims).toContain('do not preserve the later action time');
    expect(claims).not.toContain('reconciliation recovers missed activity');
    expect(sentry.diagram.answer).toContain(
      'does not establish when the resolution action occurred',
    );
    expect(sentry.diagram.records.map((record) => record.time)).not.toContain('16:02');
  });

  it('keeps GitHub release claims distinct from deployment evidence', () => {
    const github = findConnector('github');
    if (!github) throw new Error('expected GitHub connector');

    const claims = JSON.stringify(github);
    expect(claims).toContain('not proof of a production deployment');
    expect(claims).toContain('does not ingest GitHub deployment or environment records');
    expect(github.diagram.answer).toContain('GitHub release v2.8.0 published');
    expect(claims).not.toContain('Release published to production');
    expect(claims).not.toContain('What shipped in last week’s releases?');
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
    expect(publicClaims).not.toContain(
      'Timeline admits changes only when their parent tree or shared-drive ID matches a deliberately activated source',
    );
    expect(publicClaims).toContain(
      'Selecting My Drive root currently also admits live changes from shared drives',
    );
    expect(publicClaims).toContain(
      'accessible shared-drive file change can be captured with its metadata and supported body',
    );
    expect(publicClaims).toContain('Versions are sync-observed snapshots');
    expect(publicClaims).toContain('may not preserve the intermediate wording');
    expect(publicClaims).toContain('up to the first 100 shared drives returned by Google');
    expect(publicClaims).toContain('current listing does not paginate beyond that first page');
    expect(publicClaims).toContain(
      'does not currently provision a customer-configurable Drive push channel',
    );
    expect(publicClaims).not.toContain(
      'an optional push channel can signal faster incremental sync',
    );
    expect(publicClaims).not.toContain('Timeline observes each new file modification');
    expect(publicClaims).toContain('Drive removal tombstones do not include parent information');
    expect(publicClaims).toContain('even when that area was not activated');
  });
});
