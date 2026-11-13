import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';

import {
  CONNECTOR_DIRECTORY_SUMMARY,
  CONNECTOR_SLUGS,
  CONNECTORS,
  findConnector,
  getConnectorCapabilityTiers,
  INDEXABLE_CONNECTOR_ROUTES,
} from '@/components/marketing/integrations/connector-content';
import { PUBLIC_DEMO_STORY } from '@/components/marketing/public-demo-story';
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
    const capabilityTiers = getConnectorCapabilityTiers();
    const serializedRoutes = JSON.stringify(INDEXABLE_CONNECTOR_ROUTES);
    expect(serializedRoutes).not.toContain('notion');
    expect(serializedRoutes).not.toContain('jira');
    expect(capabilityTiers.mcpAccess).toContain('Notion');
    expect(capabilityTiers.mcpAccess).not.toContain('Figma');
    expect(capabilityTiers.localDesktopAccess).toEqual(['Figma']);
    expect(capabilityTiers.nativeProviders).toEqual([
      'GitHub',
      'Linear',
      'Google Drive',
      'Monday.com',
      'Slack',
      'Sentry',
    ]);
    expect(capabilityTiers.plannedProviders).toContain('HubSpot');
    expect(CONNECTOR_DIRECTORY_SUMMARY.planned.indexable).toBe(false);
  });

  it('uses one explicitly fictional Acme corpus across every provider example', () => {
    expect(PUBLIC_DEMO_STORY.organization).toBe('Acme');

    for (const connector of CONNECTORS) {
      const example = JSON.stringify({ diagram: connector.diagram, scenario: connector.scenario });
      expect(example).toContain('Acme');
      expect(example).not.toMatch(/Northline|Project Atlas|API-91|WEB-913/u);
    }
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
    expect(limitations).toContain('Slack history is processed in bounded batches');
    expect(limitations).toContain('Unfinished pages retain a continuation');
    expect(limitations).toContain('14-day recent lookback still limits recovery');
    expect(limitations).toContain('remain the first-observed snapshot');
    expect(limitations).toContain('Slack thread replies retain a page continuation');
    expect(limitations).toContain('Large threads can take multiple jobs');
    expect(limitations).toContain('at most 2,000 non-archived channels');
    expect(slack.capturedRecords).toContain(
      'Messages in selected public channels where the Slack app is a member',
    );
    expect(slack.setup.join(' ')).toContain(
      'invite the app to every selected public or private channel before syncing',
    );
    expect(slack.setup.join(' ')).toContain('fail with not_in_channel');
    expect(limitations).toContain('does not preserve Slack’s membership flag');
    expect(limitations).toContain('A listed public channel still requires the bot to be invited');
    expect(slack.permissions.join(' ')).toContain(
      'does not intersect bot access with the authorizing person’s own channel membership',
    );
    expect(slack.faqs.map((faq) => faq.answer).join(' ')).toContain(
      'bot can retain access after that person leaves a channel',
    );
    expect(slack.capturedRecords).toContain(
      'First-observed reaction aggregates anchored to message time, with their initial count and user snapshot',
    );
    expect(limitations).toContain('uses the source message timestamp');
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
    expect(githubClaims).toContain('2,000 combined issue-endpoint entries');
    expect(githubClaims).toContain('issues endpoint mixes issues and pull requests');
    expect(githubClaims).toContain('PRs consume the shared 2,000-entry scan budget');
    expect(githubClaims).toContain('2,000 review summaries per pull request');
    expect(githubClaims).toContain(
      'Issue and inline-review comment surfaces use a separate continuation',
    );
    expect(githubClaims).toContain('2,000 most recently updated repositories');
    expect(githubClaims).toContain('organization source also expands at most its 2,000');
    expect(githubClaims).toContain('lifecycle state for at most 5,000 IDs per map');
    expect(githubClaims).toContain('missed reopen webhook can be lost');
    expect(githubClaims).toContain('first-observed snapshots within each lifecycle state');
    expect(githubClaims).toContain(
      'edits that do not change lifecycle state reuse the existing immutable row',
    );
    expect(githubClaims).toContain(
      'Release revisions are keyed by release lifecycle plus a digest',
    );
    expect(githubClaims).toContain('returns to a previously captured combination');
    expect(githubClaims).toContain('reuses the earlier immutable row');
    expect(githubClaims).toContain('scheduled reconciliation runs every six hours');
    expect(githubClaims).toContain('GitHub App installation discovery is paginated');
    expect(githubClaims).toContain('No broader OAuth credential is substituted');

    expect(linear.limitations.join(' ')).toContain(
      'history begins when Timeline starts observing the selected team',
    );
    expect(linear.limitations.join(' ')).toContain(
      'move between Linear workflow states that normalize to the same Timeline bucket',
    );
    expect(linear.limitations.join(' ')).toContain('first 2,000 teams returned by the API');
    expect(linear.limitations.join(' ')).toContain('bounded batches across the selected teams');
    expect(linear.limitations.join(' ')).toContain('Page checkpoints preserve unfinished scans');
    expect(linear.limitations.join(' ')).toContain('continuation');
    expect(linear.limitations.join(' ')).toContain('multiple jobs');
    expect(linear.limitations.join(' ')).toContain('runs every six hours');
    expect(linear.limitations.join(' ')).toContain(
      'retains issue status for at most 5,000 issue IDs',
    );
    expect(linear.limitations.join(' ')).toContain(
      'fields return to a previously captured combination',
    );
    expect(monday.limitations.join(' ')).toContain(
      'Initial board activity-log backfill requests the preceding 30 days',
    );
    expect(monday.limitations.join(' ')).toContain('saved continuation progress');
    expect(monday.limitations.join(' ')).toContain('Activity-log pages are processed');
    expect(monday.limitations.join(' ')).toContain('lag Monday.com by up to 24 hours');
    expect(monday.limitations.join(' ')).toContain(
      'Scheduled Monday.com board reconciliation runs every hour',
    );
    expect(monday.limitations.join(' ')).toContain('remain stale for nearly an hour');
    expect(monday.limitations.join(' ')).toContain(
      'Polling item keys change only when the normalized lifecycle bucket changes',
    );
    expect(monday.limitations.join(' ')).toContain(
      'owner, due-date, rename, or other same-status field change',
    );
    expect(monday.limitations.join(' ')).toContain('can remain permanently absent');
    expect(monday.limitations.join(' ')).toContain('10,000 boards and 2,500 WorkDocs');
    expect(monday.limitations.join(' ')).toContain('WorkDoc refresh reads at most 10,000 blocks');
    expect(monday.limitations.join(' ')).toContain('does not persist a block-page continuation');
    expect(monday.limitations.join(' ')).toContain(
      'last lifecycle bucket for at most 5,000 item IDs',
    );
    expect(monday.limitations.join(' ')).toContain(
      'return to a previously captured status can reuse the original immutable key',
    );
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
    expect(claims).toContain('including repeated resolutions');
    expect(claims).toContain('Deployment records distinguish persisted deliveries');
    expect(claims).toContain('Retrying a delivery remains idempotent');
    expect(claims).toContain('lifecycle state for at most 5,000 issue IDs');
    expect(claims).toContain('missed regression webhook can be lost');
    expect(claims).toContain('Scheduled Sentry reconciliation runs every 24 hours');
    expect(claims).toContain(
      'Webhook capture requires an activated organization or matching project',
    );
    expect(claims).not.toContain('bypass project-selection checks');
    expect(claims).toContain('Receipt time is not a guarantee of the exact time');
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

    const publicClaims = JSON.stringify(drive);

    expect(drive.slug).toBe('google-drive');
    expect(drive.lastReviewed).toBe('2026-11-12');
    expect(publicClaims).toContain('My Drive');
    expect(publicClaims).toContain('shared drives');
    expect(publicClaims).toContain('changes.watch');
    expect(publicClaims).toContain('does not admit Shared with me');
    expect(drive.intro).not.toContain('including Shared with me');
    expect(drive.permissions.join(' ')).toContain('openid');
    expect(drive.permissions.join(' ')).toContain('email');
    expect(drive.permissions.join(' ')).toContain('stable subject identifier');
    expect(drive.permissions.join(' ')).toContain('primary email labels the connection');
    expect(drive.permissions.join(' ')).toContain('Limited Use');
    expect(drive.permissions.join(' ')).toContain('https://www.googleapis.com/auth/drive.readonly');
    expect(drive.permissions.join(' ')).not.toContain('drive.metadata.readonly');
    expect(drive.permissions.join(' ')).toContain('does not use Google user data to train');
    expect(drive.permissions.join(' ')).toContain('but retains snapshots and captured history');
    expect(publicClaims).toContain('Historical files are not enumerated');
    expect(publicClaims).toContain('baseline snapshot without writing an event');
    expect(publicClaims).toContain('keeps the latest extracted text to detect later changes');
    expect(publicClaims).toContain('remaining selections no longer cover it');
    expect(publicClaims).toContain('does not harvest Drive files into the document drive');
    expect(publicClaims).toContain('quiet editing window of about 15 minutes');
    expect(publicClaims).toContain('at most one hour');
    expect(publicClaims).toContain('webhook-delivery worker');
    expect(publicClaims).toContain('delayed `drive.file` job');
    expect(publicClaims).toContain('changes.list');
    expect(publicClaims).toContain('about once a day');
    expect(publicClaims).toContain('every tab, including nested child tabs');
    expect(publicClaims).toContain('including hidden tabs');
    expect(publicClaims).toContain('Pending suggested inserts');
    expect(publicClaims).toContain('Stay in Drive alone');
    expect(publicClaims).toContain('8 judged files per document per day');
    expect(publicClaims).toContain('1,000 children per folder');
    expect(publicClaims).not.toContain('compact text snapshot');
    expect(publicClaims).not.toContain('Truncated text snapshots used only');
    expect(publicClaims).not.toContain(
      'Selecting My Drive root currently admits any changed file the connected account can access',
    );
    expect(publicClaims).not.toContain(
      'changed Shared with me file or accessible shared-drive file can therefore be captured',
    );
    expect(publicClaims).not.toContain('Document-body harvest and version creation');
    expect(publicClaims).not.toContain(
      'does not currently provision a customer-configurable Drive push channel',
    );
  });
});
