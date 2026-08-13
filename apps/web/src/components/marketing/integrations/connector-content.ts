import { listCatalog } from '@timeline/shared/integrations/registry';

import type { CatalogEntry } from '@timeline/shared/integrations/registry';

import { PUBLIC_DEMO_STORY } from '@/components/marketing/public-demo-story';

export const CONNECTOR_SLUGS = [
  'slack',
  'github',
  'linear',
  'google-drive',
  'monday',
  'sentry',
] as const;

type ConnectorSlug = (typeof CONNECTOR_SLUGS)[number];

type NativeProviderId = 'slack' | 'github' | 'linear' | 'google_drive' | 'monday' | 'sentry';

interface ConnectorRecord {
  label: string;
  detail: string;
  time: string;
}

interface ConnectorRecipe {
  title: string;
  summary: string;
  sources: readonly string[];
}

interface ConnectorFaq {
  question: string;
  answer: string;
}

export interface ConnectorContent {
  slug: ConnectorSlug;
  providerId: NativeProviderId;
  name: string;
  eyebrow: string;
  hero: string;
  intro: string;
  seoTitle: string;
  seoDescription: string;
  logo: string;
  lightLogoTileInDarkMode: boolean;
  capability: 'Native integration';
  lastReviewed: `${number}-${number}-${number}`;
  captureStatement: string;
  providerStatement: string;
  diagram: {
    question: string;
    records: readonly ConnectorRecord[];
    answer: string;
    citations: readonly string[];
  };
  exampleQuestions: readonly string[];
  scenario: {
    title: string;
    situation: string;
    chronology: readonly string[];
    result: string;
  };
  capturedRecords: readonly string[];
  recipes: readonly ConnectorRecipe[];
  setup: readonly string[];
  permissions: readonly string[];
  limitations: readonly string[];
  faqs: readonly ConnectorFaq[];
  related: readonly ConnectorSlug[];
}

export interface ConnectorRouteSummary {
  path: `/integrations/${ConnectorSlug}`;
  slug: ConnectorSlug;
  providerId: NativeProviderId;
  name: string;
  capability: 'native';
  indexable: true;
  lastReviewed: string;
  description: string;
}

const LAST_REVIEWED = '2026-08-13' as const;
const DEMO_CONNECTORS = PUBLIC_DEMO_STORY.connectors;

export const CONNECTORS: readonly ConnectorContent[] = [
  {
    slug: 'slack',
    providerId: 'slack',
    name: 'Slack',
    eyebrow: 'Conversation becomes chronology',
    hero: 'Turn selected Slack history into cited operational memory.',
    intro:
      'Timeline preserves the messages, threads, file-share metadata, reactions, and edits you choose, then places them beside work from other systems. Ask what was decided and inspect the conversation behind the answer.',
    seoTitle: 'Slack integration for cited team answers',
    seoDescription:
      'Sync selected Slack channels, threads, file-share metadata, reactions, and edits into The Timeline, then ask questions with citations back to the conversation.',
    logo: '/connectors/slack.svg',
    lightLogoTileInDarkMode: true,
    capability: 'Native integration',
    lastReviewed: LAST_REVIEWED,
    captureStatement:
      'Timeline captures history from selected channels as immutable, citable events. Its separate Slack conversation mode handles direct agent chats, explicit capture, /ask, and @Timeline replies.',
    providerStatement:
      'Slack remains the place where messages are sent, channels are managed, and workspace permissions are administered. Timeline does not replace or modify those Slack workflows.',
    diagram: DEMO_CONNECTORS.slack.diagram,
    exampleQuestions: [
      'What did the team decide about pricing last week?',
      'Which customer promises are still open in #accounts?',
      'Summarize the launch discussion and link every source.',
      'What changed after the incident thread started?',
    ],
    scenario: DEMO_CONNECTORS.slack.scenario,
    capturedRecords: [
      'Messages in selected public channels where the Slack app is a member',
      'Messages in selected private channels where the bot is present',
      'Thread roots and replies',
      'File shares and file metadata',
      'First-observed reaction aggregates anchored to message time, with their initial count and user snapshot',
      'Message edits observed during reconciliation',
    ],
    recipes: [
      {
        title: 'Decision to delivery',
        summary: 'Connect the discussion to the issue and pull request that implemented it.',
        sources: ['Slack', 'Linear', 'GitHub'],
      },
      {
        title: 'Client handoff',
        summary: 'Combine client-channel decisions with the latest supporting documents.',
        sources: ['Slack', 'Google Drive'],
      },
      {
        title: 'Incident narrative',
        summary: 'Place the response thread beside the error lifecycle and the code fix.',
        sources: ['Slack', 'Sentry', 'GitHub'],
      },
    ],
    setup: [
      'Connect the Slack workspace with a person-owned OAuth connection.',
      'Choose from channels returned to the Slack bot, then invite the app to every selected public or private channel before syncing. A listed public channel can still fail with not_in_channel when the bot is not a member.',
      'Have a team admin activate the shared channel sources.',
      'Let hourly reconciliation capture history; configure the separate Slack app flow for /ask and conversational capture.',
    ],
    permissions: [
      'Timeline requests channel and group read/history access, plus file, reaction, and user read access.',
      'A selected public or private channel is readable only when the Slack app is a member; the native connector does not intersect bot access with the authorizing person’s own channel membership.',
      'The OAuth installation is initiated by a person, but native history sync uses the workspace bot token. Only explicitly shared channels can be activated by the team, and every selected channel still requires bot membership for history reads.',
      'Previously captured evidence remains team-scoped if a connection later needs attention.',
    ],
    limitations: [
      'Slack file shares contribute the title, filename, MIME type, and private source URL. This native history path does not download or inspect attachment bodies.',
      'Native workspace ingestion reconciles selected channels hourly; it is not a real-time mirror of every workspace event.',
      'After the initial history backfill, reconciliation looks back 14 days. Edits and reactions on older messages—and new replies whose thread root is older than that window—may not be observed.',
      'Each incremental channel scan reads at most 25 history pages, or 5,000 messages at the requested page size, inside that 14-day window. The current recent scan advances to the newest returned message without persisting a continuation for an unprocessed gap, so activity beyond the page cap can be omitted and later age out of the lookback.',
      'A single Slack thread is capped at the first 2,000 replies returned. The current sync does not persist a reply-page continuation, so replies beyond that cap remain absent on later runs.',
      'A reaction row is immutable, keyed by message plus emoji, and uses the source message timestamp rather than the time someone reacted. Later users or count changes for an already captured emoji do not update that row, so its count and user list remain the first-observed snapshot.',
      'The source picker returns at most 2,000 non-archived channels, but does not preserve Slack’s membership flag. A listed public channel still requires the bot to be invited, private channels without the app are absent, and channels beyond the listing cap cannot be selected.',
      'Timeline does not send, edit, delete, archive, or administer Slack messages through this native history sync.',
    ],
    faqs: [
      {
        question: 'Does Timeline index our entire Slack workspace?',
        answer:
          'No. A connection owner shares specific channels, a team admin activates only the sources the team wants in Timeline, and the Slack app must be a member of each selected public or private channel before history sync can read it.',
      },
      {
        question: 'Can Timeline read private Slack channels?',
        answer:
          'It can read selected private channels where the Slack app is present. Access follows the bot token and is not intersected with the authorizing person’s current membership, so the bot can retain access after that person leaves a channel.',
      },
      {
        question: 'Is Slack search being replaced?',
        answer:
          'No. Slack still searches Slack. Timeline connects selected Slack evidence to chronology and work from other systems, then produces cited cross-tool answers.',
      },
      {
        question: 'Is /ask part of this sync?',
        answer:
          'The same Slack app can support both, but they are distinct modes. Native ingestion passively syncs selected channel history; conversation mode handles /ask, @Timeline, and explicit capture.',
      },
    ],
    related: ['google-drive', 'linear', 'github'],
  },
  {
    slug: 'github',
    providerId: 'github',
    name: 'GitHub',
    eyebrow: 'Code activity becomes release history',
    hero: 'Connect the plan, review, merge, release, and CI evidence.',
    intro:
      'Timeline turns selected repository activity into a chronological, citable record. Follow work from issue through review and release without treating a pull request title as the whole story.',
    seoTitle: 'GitHub integration for cited release history',
    seoDescription:
      'Sync GitHub pull requests, issues, reviews, comments, commits, releases, and workflow runs into a cited chronology with The Timeline.',
    logo: '/connectors/github.svg',
    lightLogoTileInDarkMode: true,
    capability: 'Native integration',
    lastReviewed: LAST_REVIEWED,
    captureStatement:
      'Timeline captures selected repository activity as immutable evidence and can map synced issues and pull requests to human-readable work items.',
    providerStatement:
      'GitHub continues to host repositories, reviews, checks, releases, access rules, and branch protection. Timeline reads authorized activity; it does not become your code host.',
    diagram: DEMO_CONNECTORS.github.diagram,
    exampleQuestions: [
      'What did GitHub publish in last week’s releases?',
      'Which pull requests changed the migration path?',
      'What was discussed before PR #482 was approved?',
      'Which CI failures delayed the release?',
    ],
    scenario: DEMO_CONNECTORS.github.scenario,
    capturedRecords: [
      'Pull requests and first-observed snapshots within each lifecycle state',
      'Issues and first-observed snapshots within each lifecycle state',
      'Issue comments and pull request conversation comments',
      'Review summaries and inline review comments',
      'Default-branch commits within the initial-history cap, plus observed push activity',
      'Releases and GitHub Actions workflow runs',
    ],
    recipes: [
      {
        title: 'Plan versus published',
        summary: 'Reconcile Linear issue movement with code, CI, and GitHub release publication.',
        sources: ['Linear', 'GitHub'],
      },
      {
        title: 'Incident to fix',
        summary:
          'Trace a Sentry issue through the pull request and GitHub release tied to remediation.',
        sources: ['Sentry', 'GitHub'],
      },
      {
        title: 'Release communication',
        summary: 'Pair GitHub release publication with the decisions that preceded it in Slack.',
        sources: ['Slack', 'GitHub'],
      },
    ],
    setup: [
      'Connect GitHub through the configured GitHub App OAuth flow.',
      'Choose individual repositories for a fixed scope. Use an organization scope only when the GitHub App installation covers every repository you expect Timeline to sync.',
      'Have a team admin activate the shared sources.',
      'Use signed GitHub App webhooks for prompt activity; scheduled reconciliation runs every six hours as a bounded recovery path.',
    ],
    permissions: [
      'Timeline requests repo and read:org OAuth scopes.',
      'The GitHub App needs read access to Contents, Issues, Pull requests, Actions, and Metadata for the complete record.',
      'Organization expansion follows the connection owner’s OAuth access. Repository sync uses a matching GitHub App installation token when Timeline discovers one, but currently falls back to the broad OAuth token when it cannot match an installation.',
      'OAuth tokens and GitHub App credentials are encrypted at rest.',
    ],
    limitations: [
      'A published GitHub release is publication evidence, not proof of a production deployment. This connector does not ingest GitHub deployment or environment records.',
      'Initial default-branch commit history is capped at 2,000 commits. If a repository has more, older commits are omitted and the current backfill does not resume past that cap.',
      'Other bounded GitHub scans also stop without continuing past 2,000 pull requests per state, 2,000 combined issue-endpoint entries, 2,000 releases or workflow runs per surface, and 2,000 review summaries per pull request. GitHub’s issues endpoint mixes issues and pull requests; Timeline filters PR entries only after fetching, so PRs consume the shared 2,000-entry scan budget and can leave fewer genuine issues. Issue and inline-review comment surfaces use a separate continuation path.',
      'The source picker lists at most 2,000 organizations and the 2,000 most recently updated repositories available to the OAuth user. Older repositories outside that window cannot be chosen as individual fixed-scope sources.',
      'An organization source also expands at most its 2,000 most recently updated repositories. Older repositories beyond that cap are omitted even when the GitHub App installation has all-repository access.',
      'For an organization scope, install the GitHub App for all repositories you expect Timeline to capture. A repository visible to the OAuth user but excluded from a selected-repositories App installation can be selected yet fail to sync.',
      'GitHub App discovery currently inspects only the first 100 installations returned during OAuth. If Timeline cannot match a repository owner to a discovered installation, repository API reads fall back to the connection owner’s broad OAuth token instead of failing closed; an activated organization source can therefore admit OAuth-visible repositories outside the intended App installation boundary.',
      'Scheduled GitHub reconciliation runs every six hours. Without a matching webhook or another targeted sync trigger, recoverable activity can remain stale for nearly six hours.',
      'Commit reconciliation polls the repository default branch. A missed push webhook for commits that exist only on an unmerged non-default branch is not recovered unless those commits later reach the default branch.',
      'Polling retains issue and pull-request lifecycle state for at most 5,000 IDs per map. After an older closed entry is pruned, a missed reopen webhook can be lost because polling may reuse the original immutable open key.',
      'Issue and pull-request records are first-observed snapshots within each lifecycle state. Title, body, assignee, label, or milestone edits that do not change lifecycle state reuse the existing immutable row and do not create new chronology evidence.',
      'Release revisions are keyed by release lifecycle plus a digest of tag, name, and body, not by update time. If release content returns to a previously captured combination, Timeline reuses the earlier immutable row instead of recording the repeated value as new chronology evidence.',
      'Missing pull-request permission can leave PR activity incomplete while other readable repository surfaces continue to sync.',
      'An organization scope is access-aware; private or SAML-protected repositories may require additional GitHub authorization.',
      'Timeline does not push code, merge pull requests, change repository settings, or replace GitHub release controls.',
    ],
    faqs: [
      {
        question: 'Can I connect only one repository?',
        answer:
          'Yes, when it appears in the picker’s 2,000 most recently updated repositories. Older repositories beyond that cap cannot currently be selected individually. Organization selection also expands at most 2,000 recently updated repositories and should be used only when the GitHub App installation covers every repository you expect Timeline to sync.',
      },
      {
        question: 'Does Timeline capture review comments?',
        answer:
          'Yes. It captures review summaries, ordinary pull request conversation comments, and inline review comments when the GitHub App has the required access.',
      },
      {
        question: 'Does Timeline modify GitHub?',
        answer:
          'No. The native integration is a read and capture path for cited evidence. GitHub remains authoritative for code, reviews, checks, and releases.',
      },
      {
        question: 'How quickly does activity appear?',
        answer:
          'Configured signed webhooks carry normal PR, issue, release, workflow, and push activity promptly. Scheduled reconciliation runs every six hours across repository surfaces, but commit recovery polls only the default branch, so non-default-branch-only pushes rely on webhook delivery.',
      },
    ],
    related: ['linear', 'sentry', 'slack'],
  },
  {
    slug: 'linear',
    providerId: 'linear',
    name: 'Linear',
    eyebrow: 'Issue movement becomes a work narrative',
    hero: 'See why work moved, not only which status changed.',
    intro:
      'Timeline captures selected Linear teams as cited history, including issue context, comments, priority, ownership, status, and project changes. Connect plans to the conversations and code that made them real.',
    seoTitle: 'Linear integration for cited project history',
    seoDescription:
      'Sync Linear issues, comments, status, assignee, priority, and project changes into The Timeline for cited project updates and answers.',
    logo: '/connectors/linear.svg',
    lightLogoTileInDarkMode: false,
    capability: 'Native integration',
    lastReviewed: LAST_REVIEWED,
    captureStatement:
      'Timeline captures activity from selected Linear teams and treats synced issues and projects as evidence-backed work artifacts.',
    providerStatement:
      'Linear remains the system for creating, prioritizing, assigning, and moving issues and projects. Timeline does not replace Linear planning or mutate its records through this integration.',
    diagram: DEMO_CONNECTORS.linear.diagram,
    exampleQuestions: [
      'Which ENG issues did the team complete this week?',
      'Why did the launch project move dates?',
      'What high-priority work is still blocked?',
      'Which issue comments changed the implementation plan?',
    ],
    scenario: DEMO_CONNECTORS.linear.scenario,
    capturedRecords: [
      'Issues, titles, descriptions, identifiers, and lifecycle changes',
      'Issue comments and distinct observed comment bodies',
      'Distinct observed status buckets',
      'Distinct observed assignee values',
      'Distinct observed priority values',
      'Projects and distinct observed project field states',
    ],
    recipes: [
      {
        title: 'Issue to release',
        summary: 'Show whether planned work reached review, CI, and release.',
        sources: ['Linear', 'GitHub'],
      },
      {
        title: 'Decision to issue',
        summary: 'Connect the channel conversation to the resulting project change.',
        sources: ['Slack', 'Linear'],
      },
      {
        title: 'Launch readiness',
        summary: 'Compare project state with the latest launch checklist and runbook.',
        sources: ['Linear', 'Google Drive'],
      },
    ],
    setup: [
      'Connect Linear with a person-owned OAuth connection.',
      'Choose the Linear teams that person is allowed to share.',
      'Have a Timeline team admin activate the selected sources.',
      'Configure the signed Linear webhook for exact workflow-state transitions; scheduled reconciliation runs every six hours as a bounded recovery path for polled snapshots.',
    ],
    permissions: [
      'Timeline requests Linear’s read scope.',
      'The connection owner can share only Linear teams they are allowed to access.',
      'Non-owners cannot browse unshared provider resources through Timeline.',
      'Connection tokens are encrypted at rest and team activation is separate from personal authorization.',
    ],
    limitations: [
      'The first sync captures current issue and project fields, not their earlier field transitions. Status, assignee, priority, and project-change history begins when Timeline starts observing the selected team.',
      'Initial history and every incremental recovery pass are each capped separately at 2,500 issues, 2,500 comments, and 2,500 projects across the complete selected-team set, not per team. A high-volume team can crowd older records or changes from another selected team out of a surface. After a capped incremental batch, Timeline advances that surface’s updated-at cursor to the newest fetched timestamp without persisting a page continuation, so overflowed older changes are not revisited and can be permanently absent.',
      'Scheduled Linear reconciliation runs every six hours. Without webhook delivery, supported issue, comment, and project changes can remain stale for nearly six hours.',
      'The Linear source picker lists at most the first 2,000 teams returned by the API; teams beyond that cap cannot be selected.',
      'Without webhook delivery, reconciliation can miss a move between Linear workflow states that normalize to the same Timeline bucket, such as Backlog to Todo or In Progress to In Review, when no other captured field changes.',
      'Polling retains issue status for at most 5,000 issue IDs. After pruning, a missed reopen webhook can be lost when polling regenerates the original open-state digest.',
      'Linear issue, comment, and project events are keyed by their current captured field digest. If fields return to a previously captured combination, the reversion reuses that immutable row and does not create new chronology evidence.',
      'Only activated teams are captured; unselected Linear work stays outside Timeline.',
      'Timeline records the work history but does not create, edit, assign, or reprioritize Linear issues through this native sync.',
      'Fields outside the supported issue, comment, and project surfaces may not appear as distinct timeline events.',
    ],
    faqs: [
      {
        question: 'Can Timeline sync only one Linear team?',
        answer:
          'Yes. The connection owner shares selected teams, and the Timeline admin activates only the desired sources.',
      },
      {
        question: 'Are issue comments searchable?',
        answer:
          'Yes. Captured issue comments become citable history and can support answers alongside issue and project changes.',
      },
      {
        question: 'Will Timeline change our Linear issues?',
        answer:
          'No. This native integration reads selected work into Timeline. Linear remains authoritative for issue and project state.',
      },
      {
        question: 'Why combine Linear with GitHub?',
        answer:
          'Linear explains the plan and issue movement; GitHub provides implementation, review, CI, and release evidence. Timeline can answer across both without flattening their roles.',
      },
    ],
    related: ['github', 'slack', 'google-drive'],
  },
  {
    slug: 'google-drive',
    providerId: 'google_drive',
    name: 'Google Drive',
    eyebrow: 'File change becomes durable evidence',
    hero: 'Turn new Drive changes into cited document evidence.',
    intro:
      'Timeline watches admitted Google Drive changes after its first successful reconciliation establishes a changes cursor. Selecting a shared drive scopes live files to that drive; selecting My Drive root currently admits changed files anywhere the connected account can access, including Shared with me and other shared drives. When a supported file changes and the connection owner still belongs to the Timeline team, Timeline stores its current content as a versioned document so later answers can cite the state it observed.',
    seoTitle: 'Google Drive integration for cited document answers',
    seoDescription:
      'Capture sync-observed Google Drive file states in The Timeline for cited cross-tool answers and versioned evidence, with explicit source-scope limitations.',
    logo: '/connectors/google-drive.svg',
    lightLogoTileInDarkMode: false,
    capability: 'Native integration',
    lastReviewed: LAST_REVIEWED,
    captureStatement:
      'Timeline records admitted Drive changes as cited events and versions the supported file state observed at sync time, subject to the boundaries disclosed below.',
    providerStatement:
      'Google Drive remains the place where files are authored, shared, organized, and permissioned. Timeline reads changed content admitted by its current source rules; it does not replace Drive collaboration or rewrite source files.',
    diagram: DEMO_CONNECTORS.googleDrive.diagram,
    exampleQuestions: [
      'Summarize the latest partnership agreement.',
      'What changed between the last two launch plans?',
      'Which document supports the pricing decision?',
      'Which files changed in the client shared drive this week?',
    ],
    scenario: DEMO_CONNECTORS.googleDrive.scenario,
    capturedRecords: [
      'New file changes observed under an activated My Drive root after the first successful reconciliation cursor',
      'New file changes observed inside activated shared drives after the first successful reconciliation cursor',
      'Changed Shared with me files and accessible shared-drive files admitted when My Drive root is active',
      'Drive removal tombstones with a file ID and removal time',
      'File names, MIME types, modification times, owners, and source links',
      'Supported changed-file content up to the ingestion limit',
      'Timeline document versions created from supported file states observed at sync time',
    ],
    recipes: [
      {
        title: 'Conversation plus contract',
        summary: 'Answer from the client discussion and the governing document together.',
        sources: ['Slack', 'Google Drive'],
      },
      {
        title: 'Plan plus checklist',
        summary: 'Compare project movement with the latest runbook or launch plan.',
        sources: ['Linear', 'Google Drive'],
      },
      {
        title: 'Board plus brief',
        summary: 'Connect operational records to the documents that define their scope.',
        sources: ['Monday.com', 'Google Drive'],
      },
    ],
    setup: [
      'Connect Google Drive with a person-owned OAuth connection.',
      'Choose My Drive root or one or more shared drives that person can share.',
      'Have a Timeline team admin activate the shared sources.',
      'Let the first successful reconciliation establish the Drive changes cursor, then use the 15-minute scheduled reconciliation policy to process later changes. Timeline does not currently provision a customer-configurable Drive push channel.',
    ],
    permissions: [
      'OAuth requests read-only Drive content and metadata plus openid and email. Google’s stable subject identifier anchors the provider account identity, and its primary email labels the connection.',
      'The connection sees only files the authorizing Google account is allowed to read.',
      'Selecting a shared drive admits live changes from that drive. Selecting My Drive root currently admits any changed file the connected account can access—including Shared with me files and files in other shared drives—even when those locations were not separately activated.',
      'Non-owners cannot use Timeline to browse the connection owner’s unshared Drive resources.',
      'OAuth credentials are encrypted at rest; Timeline’s own team and event visibility rules still apply after capture.',
    ],
    limitations: [
      'Activation only queues the first sync; it does not persist a Drive cursor. A cursor is requested when reconciliation runs and saved only as that work progresses, so capture effectively begins at the cursor used by the first successful reconciliation. Changes made between activation and that cursor can precede it and are never returned. Untouched files that already existed are not enumerated or imported.',
      'Scheduled Drive reconciliation becomes due every 15 minutes and is evaluated by the worker’s five-minute integration tick. Without an operator-registered push channel, a supported post-cursor file change can remain absent for roughly that interval plus scheduling delay.',
      'Versions are sync-observed snapshots, not a copy of every Drive edit. If a file changes multiple times before reconciliation, Timeline downloads the current body and may not preserve the intermediate wording.',
      'Document-body harvest and version creation require the person who connected Drive to remain a member of the Timeline team. If that person leaves, change metadata continues to land and the Drive cursor still advances, but file bodies and versions are skipped. Reconnecting under a current member resumes future reported changes; intervening file states are not recovered unless Drive reports another change for the file.',
      'The source picker exposes My Drive root and up to the first 100 shared drives returned by Google; the current listing does not paginate beyond that first page or offer arbitrary individual subfolders.',
      'My Drive root is not an ancestry boundary in the current change filter. If root is active, every non-removed file in the account-wide changes feed passes before parent inspection. A changed Shared with me file or accessible shared-drive file can therefore be captured with its metadata and supported body even when it is outside the user’s My Drive and that location was not separately activated.',
      'Drive removal tombstones do not include parent information. Timeline may therefore record a file ID and removal time for a deleted file elsewhere in the connected account, even when that area was not activated; no file body is present in that tombstone.',
      'Files over 20 MB and unsupported Google-native formats still produce change metadata, but their bodies are not added to the document library.',
      'Timeline does not ingest Drive comments or Activity history, edit files, change sharing settings, or replace Google Docs collaboration.',
    ],
    faqs: [
      {
        question: 'Which Google Drive sources can I activate?',
        answer:
          'The current source picker offers My Drive root and up to the first 100 shared drives returned for the connection owner. It does not paginate further or offer arbitrary individual subfolders. A shared-drive-only selection scopes live files to that drive, but selecting My Drive root currently admits changed files anywhere the account can access, including Shared with me and other shared drives.',
      },
      {
        question: 'Can answers cite a specific document version?',
        answer:
          'When reconciliation observes a supported changed file and the connection owner remains a Timeline team member, Timeline stores its current content as a document version and can cite that captured evidence. Separate observed sync states can become separate versions; edits between syncs may collapse into the latest body. If the connector leaves the team, metadata continues while body capture pauses, and reconnecting does not recover intervening states unless Drive reports another change. Timeline does not import the file’s earlier Drive revision history.',
      },
      {
        question: 'What happens if a file is removed?',
        answer:
          'Timeline records the Drive tombstone while retaining previously captured evidence according to its immutable event-history model. Because Drive omits parent information from removal tombstones, the current sync can record a deleted file’s ID and removal time even when its former area was not activated; the tombstone contains no file body.',
      },
      {
        question: 'Does Timeline write changes back to Drive?',
        answer:
          'No. Drive remains authoritative for document content, collaboration, and permissions. The integration is a read and capture path.',
      },
    ],
    related: ['slack', 'linear', 'monday'],
  },
  {
    slug: 'monday',
    providerId: 'monday',
    name: 'Monday.com',
    eyebrow: 'Board activity becomes an evidence trail',
    hero: 'Follow records, subitems, updates, columns, and WorkDocs as one chronology.',
    intro:
      'Timeline captures selected Monday.com boards and WorkDocs without reducing them to status snapshots. See the updates, replies, owners, columns, and nested work that explain how an operational record changed.',
    seoTitle: 'Monday.com integration for cited board history',
    seoDescription:
      'Sync Monday.com boards, records, subitems, updates, columns, replies, and WorkDocs into The Timeline as cited operational evidence.',
    logo: '/connectors/monday.svg',
    lightLogoTileInDarkMode: false,
    capability: 'Native integration',
    lastReviewed: LAST_REVIEWED,
    captureStatement:
      'Timeline captures selected boards, nested records, conversations, schema, and WorkDocs as immutable, citable history.',
    providerStatement:
      'Monday.com remains the place where boards, automations, columns, assignments, and WorkDocs are managed. Timeline does not replace or control the board.',
    diagram: DEMO_CONNECTORS.monday.diagram,
    exampleQuestions: [
      'Which launch-board records changed this week?',
      'Why did this implementation move to at risk?',
      'Which subitems are blocking the parent record?',
      'What did the latest WorkDoc change about the plan?',
    ],
    scenario: DEMO_CONNECTORS.monday.scenario,
    capturedRecords: [
      'Selected boards and board schema',
      'Items, subitems, and multi-level descendants supported by the board',
      'Owners, statuses, due fields, and other column activity',
      'Item updates and threaded replies',
      'Record lifecycle and deletion observations',
      'Selected WorkDocs and document updates within the block-ingestion cap',
    ],
    recipes: [
      {
        title: 'Board plus client conversation',
        summary: 'Explain record movement with the discussion that caused it.',
        sources: ['Monday.com', 'Slack'],
      },
      {
        title: 'Board plus source document',
        summary: 'Ground delivery status in the brief, agreement, or runbook.',
        sources: ['Monday.com', 'Google Drive'],
      },
      {
        title: 'Operational incident',
        summary: 'Connect affected customer records to the engineering incident trail.',
        sources: ['Monday.com', 'Sentry', 'GitHub'],
      },
    ],
    setup: [
      'Connect a Monday.com account through Timeline’s OAuth app flow.',
      'Choose the boards and WorkDocs to share; classic helper boards for subitems stay hidden because the parent selection already includes them.',
      'Have a Timeline team admin activate the shared sources.',
      'Timeline provisions board webhooks when allowed and continues hourly reconciliation independently for history and recovery.',
    ],
    permissions: [
      'Timeline requests read scopes for boards, users, updates, WorkDocs, and account metadata.',
      'Webhook read and write scopes allow Timeline to provision selected-board webhooks.',
      'The connection owner exposes only boards and WorkDocs they deliberately share with the Timeline team.',
      'OAuth tokens are encrypted at rest and captured events remain team-scoped.',
    ],
    limitations: [
      'Initial board activity-log backfill requests the preceding 30 days but reads only Monday.com’s first default response page. Additional activity inside that window is omitted because the current sync does not paginate the activity log; older changes are also not imported.',
      'Scheduled Monday.com board reconciliation runs every hour. When a webhook is missing or missed and no targeted sync wakes the source, recoverable lifecycle changes can remain stale for nearly an hour.',
      'Polling item keys change only when the normalized lifecycle bucket changes. If both the webhook and activity-log entry for an owner, due-date, rename, or other same-status field change are missed or omitted, hourly reconciliation reuses the original immutable row and advances its cursor, so that field-only change can remain permanently absent.',
      'Selected WorkDocs refresh on a daily reconciliation interval, not through board webhooks. Their captured content can therefore lag Monday.com by up to 24 hours.',
      'The source picker lists at most 10,000 boards and 2,500 WorkDocs. Resources beyond those caps cannot be selected.',
      'A WorkDoc refresh reads at most 10,000 blocks. Blocks beyond that limit are omitted on every daily refresh because the current extractor does not persist a block-page continuation.',
      'Monday reconciliation retains the last lifecycle bucket for at most 5,000 item IDs. After an older item is pruned, a missed webhook and activity-log entry followed by a return to a previously captured status can reuse the original immutable key, so polling may omit that transition.',
      'When Monday omits both board type fields, helper-board detection falls back to a name beginning with “Subitems of”. An ordinary user-created board with that prefix can therefore be hidden from the picker.',
      'Missing webhook scopes degrades prompt delivery, but selected-source reconciliation continues more slowly.',
      'Timeline does not edit board values, run automations, assign people, or replace Monday.com workflows.',
    ],
    faqs: [
      {
        question: 'Do I select Monday.com subitem boards separately?',
        answer:
          'No for classic helper boards. Selecting the parent board captures its subitems. Timeline prefers provider type fields, but if Monday omits them, a “Subitems of” name prefix is used as a fallback and can also hide a user-created board with that prefix.',
      },
      {
        question: 'Are updates and replies captured?',
        answer:
          'Yes. Timeline captures item updates and threaded replies for selected boards, subject to the authorizing account’s access.',
      },
      {
        question: 'What if webhook setup fails?',
        answer:
          'Timeline marks webhook delivery as degraded while hourly reconciliation continues for activated board sources. Recoverable lifecycle changes can remain stale for nearly an hour, but a same-status owner, due-date, rename, or other field-only change can be lost when its activity-log entry is also absent. Admins can still run a manual sync while permissions are fixed.',
      },
      {
        question: 'Will Timeline change our boards?',
        answer:
          'No. Monday.com remains authoritative. Timeline reads selected records and documents into a cited operational chronology.',
      },
    ],
    related: ['slack', 'google-drive', 'sentry'],
  },
  {
    slug: 'sentry',
    providerId: 'sentry',
    name: 'Sentry',
    eyebrow: 'Issue lifecycle becomes incident context',
    hero: 'Trace what broke, what changed, and how the fix was confirmed.',
    intro:
      'Timeline turns Sentry issue lifecycle and release activity into incident evidence. Reconciliation follows activated sources, while the current installation-level webhook route can also admit events from other projects in the same Sentry installation after its first matching delivery.',
    seoTitle: 'Sentry integration for cited incident history',
    seoDescription:
      'Sync Sentry issue lifecycle, alerts, and releases into The Timeline, with explicit project-scope and recovery limits for cited incident answers.',
    logo: '/connectors/sentry.svg',
    lightLogoTileInDarkMode: true,
    capability: 'Native integration',
    lastReviewed: LAST_REVIEWED,
    captureStatement:
      'Timeline reconciles activated Sentry organizations or projects and maps captured lifecycle and release evidence to cited incidents. Current installation-level webhook routing can admit events from an unselected project in the same installation after a matching webhook is remembered.',
    providerStatement:
      'Sentry remains the monitoring and error-diagnostics system. Timeline does not collect application telemetry on Sentry’s behalf or replace Sentry alerting, traces, performance views, or issue management.',
    diagram: DEMO_CONNECTORS.sentry.diagram,
    exampleQuestions: [
      'What broke after yesterday’s deploy?',
      'Which open issues affected checkout this week?',
      'What release preceded ACME-913?',
      'How was the incident resolved, and where is the code change?',
    ],
    scenario: DEMO_CONNECTORS.sentry.scenario,
    capturedRecords: [
      'Issues entering an open lifecycle state',
      'The first captured resolved lifecycle transition per issue',
      'The first captured ignored lifecycle transition per issue',
      'Issue alerts delivered for the remembered Sentry installation, including the project-scope caveat below',
      'Release creation activity',
      'The first captured deployment activity per Sentry release',
    ],
    recipes: [
      {
        title: 'Incident to code fix',
        summary: 'Follow the issue lifecycle through review, CI, and release.',
        sources: ['Sentry', 'GitHub'],
      },
      {
        title: 'Incident communication',
        summary: 'Connect technical state to the response thread and customer impact.',
        sources: ['Sentry', 'Slack'],
      },
      {
        title: 'Affected operations',
        summary: 'Relate an incident to delivery records or customer work in flight.',
        sources: ['Sentry', 'Monday.com'],
      },
    ],
    setup: [
      'Connect Sentry using a confidential server-side OAuth application.',
      'Choose individual projects to scope reconciliation or an organization for all accessible projects there; review the installation-webhook limitation before treating a project choice as a strict webhook boundary.',
      'Have a Timeline team admin activate the shared sources.',
      'Configure the signed Sentry integration webhook for issue, alert, and release delivery. Daily reconciliation can recover release creation and issue state only when a newer occurrence advances the polling cursor; it cannot recover webhook-only alerts or deployment records.',
    ],
    permissions: [
      'Timeline requests org:read, project:read, event:read, event:admin, and team:read.',
      'A confidential OAuth app with a client secret is required; the current adapter does not use a PKCE-only public client.',
      'The integration sees only organizations and projects available to the authorizing Sentry account.',
      'Activated project selections scope reconciliation, but the current remembered-installation webhook route does not recheck the organization/project selection on later deliveries.',
      'These credentials are separate from the DSN used to report Timeline’s own application errors.',
    ],
    limitations: [
      'Alert-trigger and release-deployment records are webhook-only. Reconciliation polls issues and release creation, so it cannot recover a missed alert or deployment delivery.',
      'Scheduled Sentry reconciliation runs every 24 hours. Even a recoverable newer occurrence or release creation can remain stale for nearly a day when its webhook is missed.',
      'After the first matching webhook stores a Sentry installation route, later deliveries for another project in that installation bypass project-selection checks and can enter the same Timeline team even when that project was not activated.',
      'A missed resolve or ignore webhook for a quiet issue may not be recovered because issue polling advances from last-seen occurrence time, which a state-only action does not update.',
      'Issue lifecycle webhooks use the issue’s Sentry first-seen or last-seen occurrence time. They do not preserve the later action time when someone resolves or ignores a quiet issue.',
      'Resolved and ignored records use one immutable lifecycle key per issue. If an issue regresses and later resolves or is ignored again, the repeated closed transition does not create a new lifecycle row.',
      'Polling retains lifecycle state for at most 5,000 issue IDs. After an older resolved issue is pruned, a missed regression webhook can be lost because polling may reuse its original immutable open key.',
      'Deployment records also use one immutable deployed key per release. If the same release is deployed again—for example to another environment—the later deployment does not create a new row.',
      'Repeated occurrences of an already-open issue coalesce into the existing lifecycle evidence instead of generating a new Timeline event for every occurrence.',
      'The native connector focuses on issue lifecycle, alerts, and releases; it is not a replacement for Sentry traces, replays, dashboards, or performance analysis.',
      'Timeline does not resolve, ignore, assign, or configure alerts in Sentry through this capture path.',
    ],
    faqs: [
      {
        question: 'Does Timeline ingest every Sentry event occurrence?',
        answer:
          'No. Timeline captures meaningful issue lifecycle and release evidence. Repeated occurrences of an already-open issue reuse the same open lifecycle record rather than creating noise.',
      },
      {
        question: 'Can I connect only selected projects?',
        answer:
          'You can choose specific projects to scope reconciliation, or an organization for all accessible projects there. That project choice is not currently a strict webhook boundary: after a matching installation route is remembered, a later delivery from another project in the same Sentry installation can also be admitted.',
      },
      {
        question: 'Is this the same as configuring a Sentry DSN?',
        answer:
          'No. The native source uses Sentry OAuth to read selected project history. A DSN is for sending application telemetry to Sentry and is configured separately.',
      },
      {
        question: 'Can Timeline resolve a Sentry issue?',
        answer:
          'No. Sentry remains authoritative for issue state and monitoring configuration. Timeline records the lifecycle so it can support cited cross-tool answers.',
      },
    ],
    related: ['github', 'slack', 'monday'],
  },
] as const;

export const INDEXABLE_CONNECTOR_ROUTES: readonly ConnectorRouteSummary[] = CONNECTORS.map(
  (connector) => ({
    path: `/integrations/${connector.slug}`,
    slug: connector.slug,
    providerId: connector.providerId,
    name: connector.name,
    capability: 'native',
    indexable: true,
    lastReviewed: connector.lastReviewed,
    description: connector.seoDescription,
  }),
);

export const CONNECTOR_DIRECTORY_SUMMARY = {
  path: '/integrations' as const,
  indexable: true as const,
  native: INDEXABLE_CONNECTOR_ROUTES,
  planned: {
    indexable: false as const,
    routePolicy: 'Disclose the tier in the directory without publishing planned connector routes.',
  },
};

export function getConnectorCapabilityTiers(catalog: readonly CatalogEntry[] = listCatalog()): {
  nativeProviders: string[];
  mcpAccess: string[];
  plannedProviders: string[];
} {
  const tiers = {
    nativeProviders: [] as string[],
    mcpAccess: [] as string[],
    plannedProviders: [] as string[],
  };

  for (const entry of catalog) {
    if (entry.kind === 'native' && entry.ingestStatus === 'implemented') {
      tiers.nativeProviders.push(entry.label);
    }
    if (entry.kind === 'mcp' && entry.status === 'mcp_available') {
      tiers.mcpAccess.push(entry.label);
    }
    if (entry.status === 'coming_soon') tiers.plannedProviders.push(entry.label);
  }

  return tiers;
}

export function findConnector(slug: string): ConnectorContent | undefined {
  return CONNECTORS.find((connector) => connector.slug === slug);
}

export function findConnectorByName(name: string): ConnectorContent | undefined {
  return CONNECTORS.find((connector) => connector.name === name);
}
