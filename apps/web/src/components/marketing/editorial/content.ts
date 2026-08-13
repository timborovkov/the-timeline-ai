import { PUBLIC_DEMO_STORY } from '@/components/marketing/public-demo-story';

/** The finalized name of Timeline's public editorial publication. */
export const EDITORIAL_PUBLICATION_NAME = 'The Record';

export const RECORD_ROUTE = '/record' as const;

export const NATIVE_EDITORIAL_PROVIDERS = [
  'GitHub',
  'Linear',
  'Google Drive',
  'Monday.com',
  'Slack',
  'Sentry',
] as const;

export const GUIDE_ROUTES = {
  slackAndDrive: '/guides/search-slack-and-google-drive-together',
  weeklyEngineeringUpdates: '/guides/weekly-engineering-updates-from-slack-linear-and-github',
  sentryReleaseIncidents: '/guides/connect-sentry-incidents-to-releases-discussions-and-fixes',
} as const;

type EditorialContentType = 'playbook' | 'dossier';
export type GuideRoute = (typeof GUIDE_ROUTES)[keyof typeof GUIDE_ROUTES];
type GuideSlug = GuideRoute extends `/guides/${infer Slug}` ? Slug : never;
type NativeEditorialProvider = (typeof NATIVE_EDITORIAL_PROVIDERS)[number];

export interface EditorialContentTypeDefinition {
  id: EditorialContentType;
  label: string;
  index: string;
  description: string;
}

interface EditorialSourceBoundary {
  provider: NativeEditorialProvider;
  role: string;
  includes: string;
  boundary: string;
}

interface EditorialWorkflowStep {
  index: string;
  title: string;
  body: string;
  output: string;
}

interface EditorialDiagramSource {
  provider: NativeEditorialProvider;
  stamp: string;
  signal: string;
}

export interface EditorialDiagram {
  label: string;
  query: string;
  sources: readonly EditorialDiagramSource[];
  chronology: readonly string[];
  answerTitle: string;
  answerBody: string;
  citations: readonly string[];
}

interface EditorialFaq {
  question: string;
  answer: string;
}

export interface EditorialGuide {
  slug: GuideSlug;
  route: GuideRoute;
  type: EditorialContentType;
  typeLabel: string;
  issue: string;
  title: string;
  shortTitle: string;
  summary: string;
  machineSummary: string;
  topics: readonly string[];
  nativeConnectors: readonly NativeEditorialProvider[];
  answer: {
    title: string;
    body: string;
    checklist: readonly string[];
  };
  context: readonly string[];
  workflow: readonly EditorialWorkflowStep[];
  diagram: EditorialDiagram;
  prompt: string;
  boundaries: readonly EditorialSourceBoundary[];
  interpretation: {
    title: string;
    body: readonly string[];
  };
  limitations: readonly string[];
  faqs: readonly EditorialFaq[];
  relatedRoutes: readonly GuideRoute[];
  cta: {
    title: string;
    body: string;
    label: string;
    href: '/sign-in';
  };
}

export const EDITORIAL_CONTENT_TYPES: readonly EditorialContentTypeDefinition[] = [
  {
    id: 'playbook',
    label: 'Playbooks',
    index: '01',
    description:
      'Answer-first workflows for recurring questions that cross tools, teams, and reporting lines.',
  },
  {
    id: 'dossier',
    label: 'Dossiers',
    index: '02',
    description:
      'Evidence-led reconstructions of projects, incidents, launches, and the decisions around them.',
  },
] as const;

export const EDITORIAL_GUIDES: readonly EditorialGuide[] = [
  {
    slug: 'search-slack-and-google-drive-together',
    route: GUIDE_ROUTES.slackAndDrive,
    type: 'playbook',
    typeLabel: 'Cross-tool search playbook',
    issue: 'Edition 001',
    title: 'How to search Slack and Google Drive together',
    shortTitle: 'Search Slack and Drive together',
    summary:
      'A practical workflow for turning shared Slack conversations and newly captured Google Drive files into one visibility-aware, cited answer.',
    machineSummary:
      'Activate selected Slack channels plus a shared drive or My Drive root, ask a bounded question across evidence captured after activation, and verify the answer through citations and Timeline visibility controls.',
    topics: ['cross-tool search', 'Slack search', 'Google Drive search', 'cited answers'],
    nativeConnectors: ['Slack', 'Google Drive'],
    answer: {
      title: 'Bring both sources into one evidence set, then ask one bounded question.',
      body: 'Connect Slack and Google Drive as native sources. Share only the Slack channels and Drive sources available today—My Drive root or selected shared drives—that contain the project, then ask Timeline a question with a named project, time window, and desired output. The useful result is not a blended blob: it is an answer whose claims point back to the conversation or file that supports them.',
      checklist: [
        'Choose the Slack channels and activated Drive root or shared drives that contain the project.',
        'Allow new Slack activity and supported Drive files changed after activation to enter the team history.',
        'Ask for a specific decision, change, owner, or unresolved question.',
        'Open the citations before treating the answer as settled fact.',
      ],
    },
    context: [
      'Slack is where a decision is often negotiated. Google Drive is where the durable brief, plan, or final wording often lands. Searching either source alone can return a technically relevant result while hiding the change that made it current.',
      'The reliable pattern is to search an intentionally shared evidence boundary rather than run two independent searches and merge the results by hand. Timeline keeps each captured source distinct, orders it by time, and lets the answer cite both kinds of evidence.',
    ],
    workflow: [
      {
        index: '01',
        title: 'Set the evidence boundary',
        body: 'Start with one real project. Select the Slack channels where the work is discussed, then activate the My Drive root or shared drives that contain its documents. Use the project name and stable identifiers in the query to narrow the broader Drive source.',
        output: 'A named project scope inside explicit Slack and Drive sources.',
      },
      {
        index: '02',
        title: 'Capture the source history',
        body: 'Slack messages, threads, edits, reactions, and shared-file signals from selected channels become source events. After Drive activation, supported files that change inside the activated root or shared drives can be mirrored into the document library, while their changes remain visible in event history.',
        output: 'Separate, time-addressable evidence captured after activation.',
      },
      {
        index: '03',
        title: 'Ask a question with edges',
        body: 'Name the project, the date range, and the kind of answer you need. “What changed in the launch plan since Monday, who agreed to it, and which document is current?” is stronger than “What is happening with launch?”',
        output: 'A query that can be checked against a finite body of evidence.',
      },
      {
        index: '04',
        title: 'Read chronology before confidence',
        body: 'Look for the order of events: an early Slack proposal, a later document revision, and any follow-up that confirms or rejects it. Recency matters, but a later message is not automatically more authoritative than an approved document.',
        output: 'A defensible sequence instead of a relevance-ranked pile.',
      },
      {
        index: '05',
        title: 'Inspect and share the answer',
        body: 'Open the citations for consequential claims. If a source is missing or the evidence conflicts, narrow the question or add the missing approved source before sharing the result.',
        output: 'A cited answer with visible gaps, ready for human review.',
      },
    ],
    diagram: PUBLIC_DEMO_STORY.editorial.slackAndDrive,
    prompt:
      'For [project], review the selected Slack and Google Drive evidence from [start date] to [end date]. Tell me what changed, which source is current, what remains unresolved, and who owns the next step. Cite every factual claim and call out conflicts instead of resolving them silently.',
    boundaries: [
      {
        provider: 'Slack',
        role: 'Conversation and decision trail',
        includes:
          'Messages, threads, edits, reactions, and file-sharing signals from selected channels.',
        boundary:
          'A connection owner shares channels and a team admin activates them. After capture, Timeline event visibility—not each viewer’s Slack membership—controls who can retrieve the evidence.',
      },
      {
        provider: 'Google Drive',
        role: 'Durable document context',
        includes:
          'Supported file bodies and file-change history captured after activation from My Drive root or selected shared drives.',
        boundary:
          'Existing files that never change after activation are not backfilled. Unsupported or oversized files may contribute metadata without searchable body text; Drive comment activity is not part of the native evidence described here.',
      },
    ],
    interpretation: {
      title: 'Treat authority and recency as separate questions.',
      body: [
        'A newer Slack message may explain why a document should change, but it does not by itself prove that the approved document changed. A revised file may be current, but it may not capture the dissent or unresolved question around it.',
        'Ask Timeline to name conflicts and identify which source supports each claim. The human reviewing the answer still decides whether a conversation, a signed-off document, or another source is authoritative for the decision at hand.',
      ],
    },
    limitations: [
      'The search boundary is the material your team connected and shared, not every item in either provider.',
      'Drive capture begins with changes after activation; an older file that never changes is not available to this workflow.',
      'A cited answer can expose disagreement; it cannot turn disagreement into approval.',
      'Provider sync and extraction may lag behind the moment a message or file changes.',
      'Ambiguous project names, duplicated documents, and renamed channels require a more explicit query.',
      'Visibility rules still apply to every result. Team membership does not grant access to private evidence.',
    ],
    faqs: [
      {
        question: 'Does this replace Slack or Google Drive search?',
        answer:
          'No. Provider search is still useful when you know the exact message or file you need. This workflow is for questions whose answer depends on evidence spread across both systems and whose claims need citations.',
      },
      {
        question: 'Can Timeline see every Slack channel and Drive folder after I connect?',
        answer:
          'No. A connection owner shares Slack channels and either My Drive root or shared drives, then a team admin activates those sources. Once evidence is captured, Timeline’s team, private, or specific-user visibility determines who can retrieve it; Timeline does not mirror each viewer’s provider membership.',
      },
      {
        question: 'What if Slack and the document disagree?',
        answer:
          'Ask the answer to show the conflict, the timestamps, and the source of each claim. Do not ask the model to choose an authority rule that your team has not defined.',
      },
    ],
    relatedRoutes: [GUIDE_ROUTES.weeklyEngineeringUpdates],
    cta: {
      title: 'Try it on one project, not the whole company.',
      body: 'Activate one channel and the smallest Drive source available, ask a question about newly changed material that you already know how to verify, and inspect every citation.',
      label: 'Start with one project',
      href: '/sign-in',
    },
  },
  {
    slug: 'weekly-engineering-updates-from-slack-linear-and-github',
    route: GUIDE_ROUTES.weeklyEngineeringUpdates,
    type: 'playbook',
    typeLabel: 'Engineering reporting playbook',
    issue: 'Edition 002',
    title: 'How to create weekly engineering and project updates from Slack, Linear, and GitHub',
    shortTitle: 'Build weekly engineering updates',
    summary:
      'A source-aware method for compiling decisions, movement, shipped work, blockers, and next steps without flattening three systems into one status list.',
    machineSummary:
      'Generate a weekly project or engineering update by combining selected Slack discussions, Linear issue and project activity, and GitHub pull request, review, default-branch commit, release, and workflow evidence into a cited, human-reviewed brief.',
    topics: ['weekly update', 'engineering status', 'project reporting', 'delivery evidence'],
    nativeConnectors: ['Slack', 'Linear', 'GitHub'],
    answer: {
      title: 'Use one reporting contract across three evidence roles.',
      body: 'Let Slack explain decisions and blockers, Linear describe planned work and status movement, and GitHub show code review, merge, release, and CI activity. Ask for the same four sections every week: outcomes, decisions, blockers, and next commitments. Require citations, then have the project owner review the update before it is distributed.',
      checklist: [
        'Map one project to its channels, Linear teams, and repositories.',
        'Use a precise weekly time window and a stable four-part output shape.',
        'Distinguish issue movement, merged code, released code, and business outcome.',
        'Review mismatches instead of hiding them in a smooth summary.',
      ],
    },
    context: [
      'A weekly update fails when it treats every tool as a duplicate task list. The useful details are usually distributed by role: intent and coordination in Slack, declared state in Linear, and implementation evidence in GitHub.',
      'The goal is not to count activity. It is to explain what meaningfully changed, which evidence supports that conclusion, and where the systems disagree about the state of the work.',
    ],
    workflow: [
      {
        index: '01',
        title: 'Define the project map',
        body: 'Write down the channels, Linear teams, and GitHub repositories that describe the same body of work. Include the Linear project name and stable public keys in the query when similarly named initiatives share a selected team.',
        output: 'One cross-system scope that refers to the same project.',
      },
      {
        index: '02',
        title: 'Fix the reporting window',
        body: 'Use explicit dates and the team timezone. “From Monday 09:00 through Friday 16:00” is auditable; “this week” becomes ambiguous around weekends, distributed teams, and scheduled delivery.',
        output: 'A repeatable temporal boundary.',
      },
      {
        index: '03',
        title: 'Assign each source a job',
        body: 'Use Slack for decisions, risks, and commitments; Linear for issue and project movement; GitHub for pull requests, reviews, comments, default-branch commits, releases, and workflow results. Evidence can cross those roles, but the distinction prevents a merge from being mistaken for an outcome.',
        output: 'A source-aware evidence plan.',
      },
      {
        index: '04',
        title: 'Generate a four-part draft',
        body: 'Ask for outcomes, decisions, blockers, and next commitments. Require a citation on each concrete claim and a separate mismatch list for items whose states differ across Linear, GitHub, or Slack.',
        output: 'A concise draft that preserves traceability.',
      },
      {
        index: '05',
        title: 'Review the exceptions',
        body: 'Check merged work that was not released, completed Linear issues with no matching implementation evidence, and Slack commitments with no owner or due date. These exceptions are often more valuable than the happy path.',
        output: 'A short list of reporting risks and missing evidence.',
      },
      {
        index: '06',
        title: 'Publish with a human owner',
        body: 'The project owner removes noise, confirms interpretations, and keeps citations attached. The update should say “no evidence found” when a section is empty rather than manufacturing progress.',
        output: 'A reviewed update that can survive follow-up questions.',
      },
    ],
    diagram: PUBLIC_DEMO_STORY.editorial.weeklyEngineering,
    prompt:
      'Create the weekly update for [project] from [start date and time] through [end date and time] in [timezone]. Use selected Slack, Linear, and GitHub evidence. Return four sections: outcomes, decisions, blockers, and next commitments. Distinguish issue completion, merge, release, and verified outcome. Cite every claim, list source mismatches, and say when evidence is missing.',
    boundaries: [
      {
        provider: 'Slack',
        role: 'Decisions, blockers, and commitments',
        includes: 'Selected-channel messages, threads, edits, reactions, and shared-file signals.',
        boundary:
          'A discussion is evidence that something was said, not proof that the work shipped or a decision was approved.',
      },
      {
        provider: 'Linear',
        role: 'Declared plan and work state',
        includes: 'Issue updates, comments, status changes, assignees, priorities, and projects.',
        boundary:
          'A Linear status reflects the tracker. It does not prove that code was released or that users received the outcome.',
      },
      {
        provider: 'GitHub',
        role: 'Implementation and delivery evidence',
        includes:
          'Pull requests, reviews, review comments, issues, conversation comments, default-branch commits, releases, and workflow runs from selected repositories.',
        boundary:
          'Native commit polling follows the repository’s default branch; feature- or release-branch commits may be absent until they reach another captured surface. A merge or passing workflow is not automatically a production deployment, customer outcome, or completed rollout.',
      },
    ],
    interpretation: {
      title: 'Report state transitions, not activity volume.',
      body: [
        'Ten comments and five commits can be noise. One approved decision, one released change, or one newly discovered blocker can be the whole update. Ask for changes in project state and the evidence behind them rather than a digest of everything that happened.',
        'When the systems disagree, preserve the disagreement. “Linear says Done; GitHub shows a merge; Slack says release is blocked” is a more useful update than choosing whichever status looks most complete.',
      ],
    },
    limitations: [
      'The update is only as complete as the selected channels, Linear teams, and repositories; project names narrow retrieval inside that source boundary.',
      'Timeline can show that an event occurred; it cannot infer customer impact without customer-impact evidence.',
      'Naming and linking conventions improve cross-system retrieval, but the guide does not assume automatic one-to-one issue and pull-request linkage.',
      'Commit polling follows each selected repository’s default branch; use pull-request, release, workflow, or discussion evidence for changes that have not reached it.',
      'Late comments, delayed sync, and work recorded after the reporting cutoff belong in the next update or a clearly marked revision.',
      'A generated update remains a draft until a human owner confirms the interpretation and audience.',
    ],
    faqs: [
      {
        question: 'Should the update list every completed issue and merged pull request?',
        answer:
          'Usually not. Lead with changes that affect the project state, then link to detailed evidence for readers who need the full activity trail.',
      },
      {
        question: 'What if Linear says Done but GitHub has no matching change?',
        answer:
          'Keep it in the mismatch list. The issue may represent non-code work, the repository may be outside the selected scope, or the tracker may be ahead of delivery evidence. The update should not guess.',
      },
      {
        question: 'Can this be used for a non-engineering project?',
        answer:
          'Yes, if the connected sources match the work. The reporting contract still holds: outcomes, decisions, blockers, and commitments, each supported by visible evidence.',
      },
    ],
    relatedRoutes: [GUIDE_ROUTES.slackAndDrive, GUIDE_ROUTES.sentryReleaseIncidents],
    cta: {
      title: 'Build one update you can audit.',
      body: 'Connect the channels, Linear scope, and repositories for one active project. Generate the update, then challenge every sentence against its citations.',
      label: 'Create a cited update',
      href: '/sign-in',
    },
  },
  {
    slug: 'connect-sentry-incidents-to-releases-discussions-and-fixes',
    route: GUIDE_ROUTES.sentryReleaseIncidents,
    type: 'dossier',
    typeLabel: 'Incident reconstruction dossier',
    issue: 'Edition 003',
    title: 'How to connect Sentry incidents to releases, discussions, and fixes',
    shortTitle: 'Connect incidents to releases and fixes',
    summary:
      'A chronology-first incident workflow that uses Sentry, GitHub, and Slack evidence while keeping correlation, hypothesis, and confirmed cause distinct.',
    machineSummary:
      'Use a Sentry issue or release as a time anchor, retrieve nearby GitHub implementation and delivery activity plus selected Slack discussion, and produce a cited incident chronology that labels causal confidence instead of inventing it.',
    topics: ['incident timeline', 'Sentry release', 'root cause evidence', 'post-incident review'],
    nativeConnectors: ['Sentry', 'GitHub', 'Slack'],
    answer: {
      title: 'Anchor on the incident window, then label what the evidence actually proves.',
      body: 'Start with the captured Sentry issue update and nearby release window. Pull in nearby GitHub pull requests, reviews, default-branch commits, releases, and workflow results, plus the selected Slack discussion where detection, mitigation, and follow-up were coordinated. Build a chronology first. Only call something the cause when the evidence confirms it; otherwise label it a correlation or hypothesis.',
      checklist: [
        'Name the Sentry project, issue, release, and exact investigation window.',
        'Separate detection, suspected change, mitigation, fix, and verification.',
        'Use GitHub and Slack to explain the response, not to overwrite Sentry facts.',
        'State causal confidence in words and cite the evidence behind it.',
      ],
    },
    context: [
      'Incident review becomes unreliable when the first plausible code change is treated as the cause. Sentry can show issue lifecycle and release evidence; GitHub can show implementation and delivery activity; Slack can show what responders observed and decided. None of those sources alone completes the causal story.',
      'Chronology narrows the candidate set. Confirmation still requires evidence such as a reproduced failure, a code-level explanation, a rollback or fix followed by recovery, or another explicit validation recorded by the team.',
    ],
    workflow: [
      {
        index: '01',
        title: 'Fix the incident anchor',
        body: 'Start with a Sentry issue key, project, and release when available. Set the window wide enough to include the suspected deployment and narrow enough that unrelated work does not dominate retrieval.',
        output: 'One issue-centered investigation window.',
      },
      {
        index: '02',
        title: 'Lay out the Sentry facts',
        body: 'Record the issue state, captured last-seen time, recurrence or resolution state, affected-user or event counts when present, and nearby Sentry releases. Treat these as observability facts, not a first-observation or root-cause conclusion.',
        output: 'A factual captured-observation and lifecycle spine.',
      },
      {
        index: '03',
        title: 'Add delivery evidence',
        body: 'Retrieve GitHub changes in the same window: pull requests, reviews, default-branch commits, releases, and workflow runs. Look for explicit references to the issue, affected component, release version, rollback, or fix.',
        output: 'A bounded set of candidate changes and delivery events.',
      },
      {
        index: '04',
        title: 'Add the response narrative',
        body: 'Bring in the selected Slack thread or channel where responders discussed symptoms, hypotheses, mitigations, owners, and verification. Preserve revisions in understanding rather than rewriting the thread as if the team knew the answer from the start.',
        output: 'A decision and coordination trail.',
      },
      {
        index: '05',
        title: 'Classify every conclusion',
        body: 'Mark links as confirmed, likely, or unknown. “Confirmed” needs explicit support. Temporal proximity alone belongs under “likely” or “unknown,” even when one change looks suspicious.',
        output: 'An incident account with visible epistemic boundaries.',
      },
      {
        index: '06',
        title: 'Close with verification',
        body: 'End the chronology with the mitigation or fix, the delivery event, and the evidence used to confirm recovery. Keep follow-up work separate from the resolved incident state.',
        output: 'A cited handoff or post-incident dossier.',
      },
    ],
    diagram: PUBLIC_DEMO_STORY.editorial.sentryIncident,
    prompt:
      'Build an incident chronology for Sentry issue [issue key] in [project] from [start time] to [end time]. Include Sentry issue and release evidence, nearby GitHub pull requests, default-branch commits, releases, and workflow results, and the selected Slack response discussion. Separate confirmed facts, likely links, and unknowns. Identify detection, mitigation, fix, and recovery evidence. Cite every factual claim.',
    boundaries: [
      {
        provider: 'Sentry',
        role: 'Detection, issue lifecycle, and release anchor',
        includes:
          'Issue updates, resolved or regressed states, issue counts and affected-user counts when present, and Sentry releases from selected projects.',
        boundary:
          'Polled issue events use Sentry’s last-seen time when present and do not preserve a separate first-seen timestamp. This evidence does not replace event-level debugging, stack-trace analysis, or reproduction; an issue near a release is correlation, not proof of causation.',
      },
      {
        provider: 'GitHub',
        role: 'Change, review, and delivery trail',
        includes:
          'Pull requests, reviews, review comments, default-branch commits, releases, and workflow runs from selected repositories.',
        boundary:
          'Native commit polling follows the repository’s default branch. The selected history may also omit feature-branch, infrastructure, configuration, feature-flag, or third-party changes captured nowhere else.',
      },
      {
        provider: 'Slack',
        role: 'Human observation and response decisions',
        includes: 'Messages and threads from selected incident or engineering channels.',
        boundary:
          'Responder statements are valuable evidence of what the team believed and did. They are not automatically verified technical facts.',
      },
    ],
    interpretation: {
      title: 'Use a confidence vocabulary the reader can challenge.',
      body: [
        'Confirmed means the cited evidence directly supports the link: for example, a reproduced failure in the changed code path and recovery after a targeted fix. Likely means several independent signals align but one confirming step is missing. Unknown means the available record cannot distinguish among plausible causes.',
        'This vocabulary makes the dossier useful during the incident and honest afterward. It also exposes the next evidence-gathering step instead of burying uncertainty under polished prose.',
      ],
    },
    limitations: [
      'Timeline organizes captured evidence; it is not an application performance monitor or debugger.',
      'Polled Sentry issues use their captured last-seen time, so the chronology cannot claim a separately preserved first observation.',
      'Temporal proximity between a release and an issue does not establish causality.',
      'GitHub commit polling follows the selected repository’s default branch; other branch commits require pull-request, release, workflow, or discussion evidence.',
      'An incident can involve systems outside the selected Sentry projects, repositories, or Slack channels.',
      'Resolution state can reflect manual handling or a temporary symptom change; verify recovery with the evidence your team trusts.',
      'Sensitive incident channels and private evidence remain subject to the viewer’s visibility rights.',
    ],
    faqs: [
      {
        question: 'Can Timeline automatically identify the commit that caused an incident?',
        answer:
          'Not as a guaranteed fact. It can place captured pull requests, default-branch commits, releases, issue activity, and discussion into one cited chronology. A confirmed causal link still needs supporting technical evidence, and uncaptured branch history remains outside that account.',
      },
      {
        question: 'Should every incident have a Slack channel?',
        answer:
          'No. Use the response surface your team actually uses. If the decision trail lives elsewhere and is not captured, the dossier should say that the coordination evidence is incomplete.',
      },
      {
        question: 'What belongs in the final incident account?',
        answer:
          'Detection, impact evidence that is actually available, the changing hypotheses, mitigation, confirmed or likely cause, fix, recovery evidence, and separately listed follow-up work. Every factual claim should remain traceable to a source.',
      },
    ],
    relatedRoutes: [GUIDE_ROUTES.weeklyEngineeringUpdates],
    cta: {
      title: 'Reconstruct one incident without erasing uncertainty.',
      body: 'Connect one Sentry project, its repository, and the response channel. Start with an incident your team already understands, then compare the dossier with the original evidence.',
      label: 'Build an incident timeline',
      href: '/sign-in',
    },
  },
] as const;

export function findEditorialGuide(slug: string): EditorialGuide | undefined {
  return EDITORIAL_GUIDES.find((guide) => guide.slug === slug);
}

export function findEditorialGuideByRoute(route: GuideRoute): EditorialGuide {
  const guide = EDITORIAL_GUIDES.find((candidate) => candidate.route === route);
  if (!guide) throw new Error(`Editorial guide not found for route: ${route}`);
  return guide;
}

export const EDITORIAL_MACHINE_SUMMARIES = [
  {
    route: RECORD_ROUTE,
    title: EDITORIAL_PUBLICATION_NAME,
    kind: 'publication-index',
    summary:
      'The Timeline publication for practical playbooks and evidence-led dossiers about turning scattered work into cited operational memory.',
    topics: ['operational memory', 'evidence', 'cited answers', 'cross-tool workflows'],
  },
  ...EDITORIAL_GUIDES.map((guide) => ({
    route: guide.route,
    title: guide.title,
    kind: guide.type,
    summary: guide.machineSummary,
    topics: [...guide.topics],
    nativeConnectors: [...guide.nativeConnectors],
  })),
] as const;

export const EDITORIAL_CANONICAL_ROUTES = EDITORIAL_MACHINE_SUMMARIES.map((entry) => entry.route);
