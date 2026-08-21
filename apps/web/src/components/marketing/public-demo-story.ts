export const PUBLIC_DEMO_DISCLOSURE = 'Fictional Acme example, not customer data.';

/**
 * One coherent fictional project for every public acquisition surface.
 * Provider pages use different slices of the same chronology so examples can
 * explain each source without resembling unrelated customer stories.
 */
export const PUBLIC_DEMO_STORY = {
  organization: 'Acme',
  project: 'Acme rollout',
  people: {
    implementationLead: { name: 'Priya Shah', role: 'Implementation lead' },
    productLead: { name: 'Maya Chen', role: 'Product lead' },
  },
  identifiers: {
    linearIssue: 'ENG-241',
    pullRequest: 'PR #482',
    workflow: 'CI #1602',
    release: 'v2.8.0',
    sentryIssue: 'ACME-913',
  },
  landing: {
    events: [
      {
        id: '01',
        day: 'Monday',
        dateTime: '2026-08-03T08:46:00+03:00',
        time: '08:46',
        source: 'Telegram / Acme launch group',
        shortSource: 'Telegram',
        title: 'Friday customer update promised',
        detail:
          'Maya Chen confirmed in the linked launch group that the customer expects an update by Friday.',
      },
      {
        id: '02',
        day: 'Monday',
        dateTime: '2026-08-03T09:14:00+03:00',
        time: '09:14',
        source: 'Slack / #acme-rollout',
        shortSource: 'Slack',
        title: 'Onboarding copy approved',
        detail: 'Maya Chen approved the onboarding copy. Implementation can continue.',
      },
      {
        id: '03',
        day: 'Tuesday',
        dateTime: '2026-08-04T11:40:00+03:00',
        time: '11:40',
        source: 'Meeting / launch review',
        shortSource: 'Meeting',
        title: 'SSO named as the blocker',
        detail: 'The launch review confirmed SSO validation is the only remaining launch blocker.',
      },
      {
        id: '04',
        day: 'Wednesday',
        dateTime: '2026-08-05T15:22:00+03:00',
        time: '15:22',
        source: 'GitHub / PR #482',
        shortSource: 'GitHub',
        title: 'Migration callback merged',
        detail: 'The migration callback merged after review and passed CI.',
      },
      {
        id: '05',
        day: 'Thursday',
        dateTime: '2026-08-06T17:08:00+03:00',
        time: '17:08',
        source: 'Timeline Document Drive / migration checklist',
        shortSource: 'Documents',
        title: 'Migration checklist added to Document Drive',
        detail:
          'The team added the checklist as durable project context. It names Priya Shah as owner and Friday as the next review.',
      },
    ],
    flow: {
      evidenceGroups: [
        {
          id: 'conversations',
          icons: ['Telegram', 'Slack', 'Email'],
          label: 'Conversations',
          detail: 'Telegram groups · Slack channels · forwarded email',
        },
        {
          id: 'knowledge',
          icons: ['Meeting', 'Documents'],
          label: 'Meetings & documents',
          detail: 'Launch review · Document Drive baseline',
        },
        {
          id: 'systems',
          icons: ['GitHub', 'Sentry'],
          label: 'Delivery & incidents',
          detail: 'GitHub changes · Sentry issues',
        },
      ],
      timelineEvents: [
        {
          id: '01',
          stamp: 'Mon 08:46',
          dateTime: '2026-08-03T08:46:00+03:00',
          source: 'Telegram group',
          title: 'Customer update due Friday',
        },
        {
          id: '03',
          stamp: 'Tue 11:40',
          dateTime: '2026-08-04T11:40:00+03:00',
          source: 'Meeting',
          title: 'SSO remains the launch blocker',
        },
        {
          id: '04',
          stamp: 'Tue 14:05',
          dateTime: '2026-08-04T14:05:00+03:00',
          source: 'Document Drive',
          title: 'Staged rollout plan added',
        },
        {
          id: '06',
          stamp: 'Wed 15:22',
          dateTime: '2026-08-05T15:22:00+03:00',
          source: 'GitHub',
          title: 'SSO callback merged',
        },
        {
          id: '07',
          stamp: 'Thu 10:08',
          dateTime: '2026-08-06T10:08:00+03:00',
          source: 'Sentry',
          title: 'Login issue regressed in staging',
        },
      ],
      workspaceRecords: [
        {
          type: 'Project',
          title: 'Acme rollout',
          detail: 'At risk · Priya · Review Fri',
          state: 'Status update',
        },
        {
          type: 'Task',
          title: 'Validate SSO',
          detail: 'Blocked · Priya · Due Fri',
          state: 'New task',
        },
        {
          type: 'CRM',
          title: 'Acme + Maya Chen',
          detail: 'Implementation · Product lead',
          state: 'Existing records linked',
        },
        {
          type: 'Decision',
          title: 'Stage the launch',
          detail: '18-team beta · Decided Tue',
          state: 'Decision record',
        },
      ],
      workspaceViews: ['CRM', 'Task boards', 'Issue tracking', 'Calendar', 'Document Drive'],
      agent: {
        surfaces: ['Web', 'Slack', 'Telegram', 'Own agent via MCP'],
        clients: ['Claude', 'Codex', 'Any MCP client'],
        question: 'What blocks launch, what is due next, and does the CRM agree?',
        answer: 'SSO still blocks launch [03][07]. Customer update due Friday [01].',
        conflict: 'CRM: On track ↔ Timeline: Blocked. Review before updating.',
      },
    },
  },
  connectors: {
    slack: {
      diagram: {
        question: 'What did we decide about the Acme rollout?',
        records: [
          {
            label: '#acme-rollout',
            detail: 'Maya Chen proposes a staged launch',
            time: '09:18',
          },
          {
            label: 'Thread reply',
            detail: 'Priya Shah confirms the 18-team beta cohort',
            time: '10:04',
          },
          {
            label: 'launch-risks.pdf',
            detail: 'Migration risk shared in the thread',
            time: '10:27',
          },
        ],
        answer:
          'The team chose a staged Acme rollout for an 18-team beta cohort, with migration risk reviewed before broad release.',
        citations: ['Slack message', 'Thread reply', 'Shared file'],
      },
      scenario: {
        title: 'A decision stops disappearing into a thread',
        situation:
          'The Acme rollout changes across a channel message, a reply thread, and a shared risk document. Two days later, leadership asks for the final decision.',
        chronology: [
          'Timeline syncs #acme-rollout and keeps the message and reply context together.',
          'The shared launch-risk file remains adjacent evidence without implying that Timeline read its attachment body.',
          'The answer resolves the staged-launch decision in time order and links to the exact Slack records.',
        ],
        result:
          'Leadership can verify the beta-cohort decision without asking the channel to reconstruct it.',
      },
    },
    github: {
      diagram: {
        question: 'What shipped for the Acme rollout?',
        records: [
          { label: 'PR #482', detail: 'Migration callback approved', time: '14:08' },
          { label: 'CI #1602', detail: 'Integration suite passed', time: '14:31' },
          { label: 'v2.8.0', detail: 'GitHub release published', time: '15:06' },
        ],
        answer:
          'GitHub release v2.8.0 published the Acme migration callback after review approval and a passing integration workflow.',
        citations: ['PR #482', 'Workflow #1602', 'Release v2.8.0'],
      },
      scenario: {
        title: 'A release note gains its missing middle',
        situation:
          'The Acme migration callback begins as planned work, changes during review, passes CI, and appears in a GitHub release. The tag alone cannot explain the verification path.',
        chronology: [
          'Timeline records PR #482, its review summary, and its review conversation.',
          'The merge and CI #1602 show when implementation and verification happened.',
          'Release v2.8.0 closes the publication sequence while citations preserve the route back to GitHub.',
        ],
        result:
          'The release summary reflects review and verification without claiming when or where the change was deployed.',
      },
    },
    linear: {
      diagram: {
        question: 'Why is the Acme rollout still waiting?',
        records: [
          { label: 'ENG-241', detail: 'SSO validation raised to urgent', time: 'Mon' },
          { label: 'Issue comment', detail: 'Test tenant needs one more run', time: 'Tue' },
          { label: 'Project update', detail: 'Friday review remains the target', time: 'Wed' },
        ],
        answer:
          'The Acme rollout is waiting on SSO validation: ENG-241 is urgent, and the test tenant needs another run before Friday’s review.',
        citations: ['ENG-241', 'Issue comment', 'Project update'],
      },
      scenario: {
        title: 'A status change gets a reason',
        situation:
          'The Acme rollout date holds while an urgent SSO issue needs another validation run. The weekly update needs the cause, not a list of changed fields.',
        chronology: [
          'Timeline records ENG-241 state, priority, assignee, and comment context.',
          'The Acme rollout project update lands in the same chronology as the issue evidence.',
          'A cited answer explains the validation dependency behind the schedule.',
        ],
        result:
          'The update explains why the rollout is waiting while Linear stays authoritative for the plan.',
      },
    },
    googleDrive: {
      diagram: {
        question: 'Who owns the next Acme rollout review?',
        records: [
          {
            label: 'migration-checklist.docx',
            detail: 'Owner changed to Priya Shah',
            time: '11:02',
          },
          {
            label: 'Captured version',
            detail: 'Friday review recorded in Timeline',
            time: '11:04',
          },
          {
            label: 'launch-plan.pdf',
            detail: 'Staged beta cohort added',
            time: '14:15',
          },
        ],
        answer:
          'Priya Shah owns Friday’s Acme migration review, and the latest captured launch plan records the staged beta cohort.',
        citations: ['Migration checklist', 'Captured version', 'Launch plan'],
      },
      scenario: {
        title: 'The answer cites the version that mattered',
        situation:
          'The Acme migration checklist changes owner and review date before a later launch plan records the staged cohort. A handoff must distinguish the states Timeline actually observed.',
        chronology: [
          'Timeline observes the changed migration checklist when Drive reconciliation processes the changes feed.',
          'The supported file state becomes a Timeline document version beside its cited change event.',
          'A later captured launch plan joins the chronology without erasing the earlier checklist version.',
        ],
        result:
          'The handoff names Priya Shah and Friday’s review while preserving the captured source versions.',
      },
    },
    monday: {
      diagram: {
        question: 'Why is the Acme rollout marked at risk?',
        records: [
          { label: 'Acme launch board', detail: 'Owner changed to Priya Shah', time: '08:42' },
          { label: 'SSO subitem', detail: 'Test-tenant validation blocked', time: '09:17' },
          { label: 'Rollout WorkDoc', detail: 'Staged-cohort fallback added', time: '12:06' },
        ],
        answer:
          'The Acme rollout is at risk because SSO validation blocks activation; Priya Shah owns the Friday review and the WorkDoc records a staged-cohort fallback.',
        citations: ['Launch board', 'SSO subitem', 'Rollout WorkDoc'],
      },
      scenario: {
        title: 'A board row becomes a traceable operating story',
        situation:
          'The Acme launch record changes owner while a nested SSO subitem describes the blocker and a WorkDoc revises the fallback. The status column alone misses the connection.',
        chronology: [
          'Timeline records the launch-board schema and record changes with their human labels.',
          'The SSO subitem and its updates remain connected to the selected parent board.',
          'The rollout WorkDoc joins the evidence sequence and supports the final answer.',
        ],
        result:
          'The team sees the current risk, Priya Shah’s ownership, and the staged fallback in one cited narrative.',
      },
    },
    sentry: {
      diagram: {
        question: 'What broke after the Acme rollout release?',
        records: [
          { label: 'Release v2.8.0', detail: 'Release creation captured', time: '15:06' },
          { label: 'ACME-913', detail: 'Onboarding callback error last seen', time: '15:19' },
          {
            label: 'ACME-913',
            detail: 'Current status observed: resolved',
            time: 'Source time 15:19',
          },
        ],
        answer:
          'ACME-913 appeared after release v2.8.0 and is now resolved; the Sentry lifecycle record does not establish when the resolution action occurred.',
        citations: ['Release v2.8.0', 'ACME-913 occurrence', 'ACME-913 status'],
      },
      scenario: {
        title: 'An alert becomes a complete incident narrative',
        situation:
          'ACME-913 opens after release v2.8.0, the team discusses impact, a pull request rolls back the change, and Sentry later reports the issue as resolved.',
        chronology: [
          'Timeline places the Sentry release and ACME-913 lifecycle evidence beside one another while retaining source occurrence timestamps.',
          'Slack and GitHub evidence can fill in impact, rollback choice, and remediation.',
          'The final answer cites each system without pretending any one record tells the whole story.',
        ],
        result:
          'The incident review starts from a sourced Acme chronology instead of manual timestamp matching.',
      },
    },
  },
  editorial: {
    slackAndDrive: {
      label: 'Illustrative Acme rollout query',
      query: 'What changed in the Acme rollout plan, and what is still undecided?',
      sources: [
        {
          provider: 'Slack',
          stamp: 'Mon / 09:14',
          signal: 'Maya Chen approves the onboarding copy in #acme-rollout.',
        },
        {
          provider: 'Google Drive',
          stamp: 'Tue / 15:40',
          signal: 'The migration checklist records Friday’s review and Priya Shah as owner.',
        },
        {
          provider: 'Slack',
          stamp: 'Wed / 11:05',
          signal: 'The rollout thread says pricing language is still open.',
        },
      ],
      chronology: ['Copy approved', 'Review assigned', 'Open pricing question'],
      answerTitle: 'The review date and owner are set; pricing is still unresolved.',
      answerBody:
        'The migration review is due Friday with Priya Shah as owner. The latest Acme rollout discussion still leaves pricing language open.',
      citations: ['01', '02', '03'],
    },
    weeklyEngineering: {
      label: 'Illustrative Acme rollout compilation',
      query: 'What changed in the Acme rollout from Monday through Friday?',
      sources: [
        {
          provider: 'Linear',
          stamp: 'Tue / 10:20',
          signal: 'ENG-241 moves to urgent while SSO validation continues.',
        },
        {
          provider: 'GitHub',
          stamp: 'Wed / 14:35',
          signal: 'PR #482 merges and CI #1602 passes.',
        },
        {
          provider: 'Slack',
          stamp: 'Thu / 16:10',
          signal: 'The broad rollout remains held for Friday’s SSO review.',
        },
      ],
      chronology: ['Blocker escalated', 'Code merged', 'Rollout held'],
      answerTitle: 'Implementation merged; the rollout is still waiting on SSO.',
      answerBody:
        'PR #482 merged with passing checks, but ENG-241 still needs another SSO validation run before Friday’s review. The evidence supports implementation completion, not broad-release readiness.',
      citations: ['01', '02', '03'],
    },
    sentryIncident: {
      label: 'Illustrative Acme incident reconstruction',
      query: 'What changed before ACME-913 appeared, and what evidence confirms the fix?',
      sources: [
        {
          provider: 'GitHub',
          stamp: '14:05',
          signal: 'Release v2.8.0 containing the migration callback is published.',
        },
        {
          provider: 'Sentry',
          stamp: '14:22',
          signal: 'ACME-913 enters an active issue state after the release.',
        },
        {
          provider: 'Slack',
          stamp: '14:47',
          signal: 'Responders reproduce the callback failure and choose a rollback.',
        },
        {
          provider: 'Sentry',
          stamp: '15:31',
          signal: 'ACME-913 is observed as resolved after the rollback window.',
        },
      ],
      chronology: ['Release', 'Detection', 'Rollback decision', 'Resolution'],
      answerTitle: 'The release is correlated; the rollback strengthens the case.',
      answerBody:
        'ACME-913 appeared after v2.8.0 and was observed as resolved after the rollback window. That sequence supports a likely connection, but the final account still needs code-level evidence before calling the release the confirmed cause.',
      citations: ['01', '02', '03', '04'],
    },
  },
} as const;
