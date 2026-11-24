import type { EditorialGuide } from '@/components/marketing/editorial/content';

export const WORKFLOW_GUIDES = [
  {
    slug: 'automate-daily-team-updates-in-slack',
    route: '/guides/automate-daily-team-updates-in-slack',
    title: 'How to automate daily team updates in Slack',
    shortTitle: 'Automate daily team updates',
    summary:
      'Set up daily team updates from captured work, choose a Slack delivery destination, and check blockers and follow-ups without asking everyone to rewrite their day.',
    machineSummary:
      'Set up daily team updates from captured work, choose a Slack delivery destination, and check blockers and follow-ups without asking everyone to rewrite their day.',
    nativeConnectors: ['Slack', 'GitHub'],
    topics: ['Automate daily team updates', 'templates', 'cited work records'],
    answer: {
      title: 'Choose between collecting updates and summarizing recorded work.',
      body: 'A scheduled check-in asks teammates to report progress. A generated daily update summarizes evidence already captured from conversations and connected tools. Use a check-in when important work happens off-channel; use a generated update when the record is useful enough to summarize. Keep a way for people to correct either version.',
      checklist: [
        'Choose one audience and a reporting window.',
        'Confirm that useful source records have arrived.',
        'Confirm the shared delivery destination and team timezone.',
        'Check blockers and owners against citations before acting.',
      ],
    },
    context: [
      'A daily update should answer what changed, what needs attention, and who owns the next step. Message counts do not answer those questions.',
      'You can begin manually: ask people to post progress, blockers and next steps in a shared thread, then have a coordinator consolidate it. Slack recaps help with conversation catch-up where available. Timeline adds a workspace update assembled from captured work.',
    ],
    workflow: [
      {
        index: '01',
        title: 'Pick the right kind of update',
        body: 'For a personal channel catch-up, try Slack’s recap features. For a team check-in, collect answers to a consistent prompt. For an update spanning conversations and delivery records, use Timeline’s captured work. Do not treat these three outputs as interchangeable.',
        output: 'An audience and a chosen method.',
      },
      {
        index: '02',
        title: 'Connect one active source',
        body: 'Link an authorized Slack channel or activate selected native Slack sources. Confirm a recent decision or blocker appears in Timeline before adding more tools. Capture authorized email or call context if that is where the team makes commitments.',
        output: 'A record that contains actual team work.',
      },
      {
        index: '03',
        title: 'Configure delivery',
        body: 'In Timeline’s team settings, ask a team admin to add an available Slack channel under Digest destinations and confirm the Team timezone. If the channel is absent, check the Slack connection and permissions first. Messaging controls your personal email or bot-DM digest; shared Slack delivery is configured separately.',
        output: 'A shared destination with an explicit audience.',
      },
      {
        index: '04',
        title: 'Inspect the first daily update',
        body: 'Open Work → Digests after the scheduled run. Review highlights, follow-ups and linked work. Open a source you already know and check that the wording preserves its meaning. An empty section can mean missing capture, not an absence of work.',
        output: 'A checked first update.',
      },
      {
        index: '05',
        title: 'Ask for a focused brief when needed',
        body: 'The automatic digest covers the workspace. For one project or a special reporting period, ask a bounded question in Ask and use the template below. This prompt does not change the scheduled digest’s format.',
        output: 'A separate project brief for the requested window.',
      },
      {
        index: '06',
        title: 'Keep corrections visible',
        body: 'Ask owners to correct a missing or inaccurate item in the source conversation. Review any proposed task or record changes separately. A daily update can mention a proposal without applying it.',
        output: 'A repeatable review habit.',
      },
    ],
    boundaries: [
      {
        provider: 'Slack',
        role: 'Decisions and coordination',
        includes: 'Messages and threads captured from selected channels.',
        boundary:
          'Connect and activate only sources you can share. After capture, Timeline visibility governs access; it does not mirror every reader’s Slack membership.',
      },
      {
        provider: 'Email',
        role: 'Written commitments',
        includes: 'Email deliberately forwarded, CCed or BCCed to the team address.',
        boundary:
          'Timeline does not automatically read your whole inbox. Check recipients and source visibility before forwarding.',
      },
      {
        provider: 'GitHub',
        role: 'Implementation evidence',
        includes:
          'Captured pull requests, reviews, releases and workflow results from selected repositories.',
        boundary:
          'Default-branch commit polling is bounded. A merge or successful workflow does not by itself establish a production deployment.',
      },
    ],
    prompt:
      'For [project], summarize captured work from [start] to [end] in [timezone]. Return changes, decisions, blockers and next steps with owners and source citations. Label pending changes and missing evidence.',
    toolkit: {
      title: 'Template and worked example',
      introduction:
        'Copy this template into a document or message. The filled example is illustrative; replace its source labels with links to your own evidence.',
      template:
        'Team / project: [name]\nWindow and timezone: [start → end]\nChanges: [what changed + evidence]\nDecisions: [decision + who confirmed + source]\nBlockers: [impact + owner + source]\nNext steps: [action + owner + date, or unknown]\nMissing evidence / pending changes: [gaps]\nReviewed by: [name]',
      example:
        'Illustrative project brief — Acme launch, 12 November\nChanges: Callback PR merged; production release not verified [GitHub PR].\nDecisions: Keep the rollout limited [Slack launch thread].\nBlockers: Customer still needs SSO validation [forwarded email].\nNext step: Priya to confirm validation timing; due date not recorded [Slack reply].\nReview: Do not describe the rollout as shipped.',
      links: [
        {
          label: 'Daily update use case',
          href: '/use-cases/team-daily-log',
        },
        {
          label: 'Slack connection and capture limits',
          href: '/integrations/slack',
        },
        {
          label: 'Work and digests',
          href: '/help/work',
        },
        {
          label: 'Slack’s native summaries and recaps',
          href: 'https://slack.com/help/articles/25076892548883-Guide-to-AI-features-in-Slack',
        },
      ],
    },
    diagram: {
      label: 'Illustrative example · fictional team',
      query: 'What changed in the Acme launch this morning?',
      sources: [
        {
          provider: 'GitHub',
          stamp: '09:10',
          signal: 'Callback PR merges.',
        },
        {
          provider: 'Email',
          stamp: '10:00',
          signal: 'Customer requests SSO validation.',
        },
        {
          provider: 'Slack',
          stamp: '10:30',
          signal: 'Priya will confirm the validation window.',
        },
      ],
      chronology: [
        'Callback PR merges.',
        'Customer requests SSO validation.',
        'Priya will confirm the validation window.',
      ],
      answerTitle: 'Code merged; validation is still outstanding.',
      answerBody:
        'The next step has an owner, but the record does not yet give a deadline or prove production delivery.',
      citations: ['01', '02', '03'],
    },
    interpretation: {
      title: 'Measure usefulness by the questions the update resolves.',
      body: [
        'Ask whether a reader can find the blocker, its owner and the original statement. If the same clarification is needed every morning, improve capture or the question before adding more summary text.',
      ],
    },
    limitations: [
      'Unrecorded calls and private work outside the shared scope are absent.',
      'A scheduled run and delivery depend on working connections and destination permissions.',
      'The example is a suggested project brief, not a promise of the exact digest layout.',
      'Source access and the delivery audience must be appropriate before sharing.',
    ],
    faqs: [
      {
        question: 'Is an automated daily update the same as an async standup?',
        answer:
          'No. An async standup normally collects fresh answers from people. A generated update uses recorded activity. Use human check-ins to cover work or concerns that have not been captured.',
      },
      {
        question: 'Can I customize the scheduled digest with this prompt?',
        answer:
          'This prompt creates a focused answer in Ask. It does not configure the automatic digest. Use team settings for available destinations and timezone controls.',
      },
      {
        question: 'What if a teammate has no activity in the update?',
        answer:
          'Check source coverage and ask the person. Missing captured activity is not evidence that someone did no work.',
      },
    ],
    relatedRoutes: [
      '/guides/track-action-items-meetings-slack-email',
      '/guides/weekly-engineering-updates-from-slack-linear-and-github',
    ],
    cta: {
      title: 'Try this with one project.',
      body: 'Start with sources you can share and a question you can verify. Inspect the supporting evidence before distributing the result.',
      label: 'Start free',
      href: '/sign-up',
    },
  },
  {
    slug: 'track-action-items-meetings-slack-email',
    route: '/guides/track-action-items-meetings-slack-email',
    title: 'How to track action items across meetings, Slack, and email',
    shortTitle: 'Track action items across conversations',
    summary:
      'Use an owner, due date, status and source for every action item. Reconcile later corrections across calls, Slack and email before updating your task board.',
    machineSummary:
      'Use an owner, due date, status and source for every action item. Reconcile later corrections across calls, Slack and email before updating your task board.',
    nativeConnectors: ['Slack'],
    topics: ['Track action items across conversations', 'templates', 'cited work records'],
    answer: {
      title: 'Keep one action record with links to the original commitment.',
      body: 'Write each action as a verb and an observable result. Attach an owner, a due date when explicitly agreed, the latest supported status, and source links. A meeting suggestion becomes a commitment only when someone accepts it; a later message may revise the date without proving the work is complete.',
      checklist: [
        'Capture the exact action and its source.',
        'Separate assigned owners from suggested owners.',
        'Keep dates unknown when nobody agreed them.',
        'Require evidence or owner confirmation before closing the task.',
      ],
    },
    context: [
      'Meeting notes can name a task while email changes its deadline and Slack records completion. Tracking only the meeting creates stale work; treating every mention as a new task creates duplicates.',
      'A shared spreadsheet is enough for a small team. Use the same columns and review it regularly. Timeline helps retrieve the supporting conversations and review proposed task changes when the history is spread across tools.',
    ],
    workflow: [
      {
        index: '01',
        title: 'Capture the commitment',
        body: 'Use an authorized meeting transcript or notes, link the relevant Slack channel, and forward the needed email to your team address. Verify that each source has processed and is visible to the intended reviewers.',
        output: 'A searchable source for each commitment.',
      },
      {
        index: '02',
        title: 'Extract actions with clear acceptance criteria',
        body: 'Ask for the action, owner, date and supporting quote or citation. “Investigate export errors” needs a result such as an explanation and a next step. Keep “we should consider” suggestions separate from accepted assignments.',
        output: 'A draft action list with unknown fields marked.',
      },
      {
        index: '03',
        title: 'Reconcile later changes',
        body: 'Search the same project and people across the reporting window. Compare the original agreement with corrections, rescheduling and completion messages. Keep a change history rather than silently replacing the original due date.',
        output: 'One current interpretation per action.',
      },
      {
        index: '04',
        title: 'Review proposed task changes',
        body: 'In Timeline, inspect proposed task or record changes before accepting them. A cited answer is not itself a task write. With a spreadsheet, make the equivalent change manually after the owner confirms it.',
        output: 'A reviewed task record.',
      },
      {
        index: '05',
        title: 'Verify completion and hand back gaps',
        body: 'Link the delivered result or the owner’s confirmation. If a source says “sent” but the recipient says it is incomplete, preserve that conflict and ask for clarification. Do not close an item because discussion went quiet.',
        output: 'Closed work with evidence, or a named follow-up.',
      },
    ],
    boundaries: [
      {
        provider: 'Slack',
        role: 'Decisions and coordination',
        includes: 'Messages and threads captured from selected channels.',
        boundary:
          'Connect and activate only sources you can share. After capture, Timeline visibility governs access; it does not mirror every reader’s Slack membership.',
      },
      {
        provider: 'Email',
        role: 'Written commitments',
        includes: 'Email deliberately forwarded, CCed or BCCed to the team address.',
        boundary:
          'Timeline does not automatically read your whole inbox. Check recipients and source visibility before forwarding.',
      },
      {
        provider: 'Meetings',
        role: 'Discussion and assigned next steps',
        includes: 'Captured meeting transcripts and notes.',
        boundary:
          'Use an authorized transcript or a consent-gated meeting bot. A transcript can misattribute a speaker or miss a correction; verify important commitments.',
      },
    ],
    prompt:
      'For [project] from [start] to [end], find commitments across captured meetings, Slack and email. Return action, owner, agreed date, latest supported status and sources. Separate suggestions, accepted commitments, revisions and completion evidence.',
    toolkit: {
      title: 'Template and worked example',
      introduction:
        'Copy this template into a document or message. The filled example is illustrative; replace its source labels with links to your own evidence.',
      template:
        'Action: [verb + observable result]\nOwner: [confirmed person / unassigned]\nAgreed date: [date + timezone / not agreed]\nStatus: [proposed / accepted / in progress / blocked / complete]\nOriginal source: [link]\nLatest correction or completion: [link]\nReview needed: [question / none]',
      example:
        'Illustrative action — Send the pilot export\nOwner: Mika [meeting transcript].\nOriginal date: Thursday [meeting transcript].\nRevised date: Friday, accepted by the customer [forwarded email].\nStatus: In progress; Slack says the export is being validated [Slack reply].\nReview needed: Update the task date after reviewing the accepted correction. Do not mark complete.',
      links: [
        {
          label: 'Capture email and meeting context',
          href: '/help/capture',
        },
        {
          label: 'Review work and proposed changes',
          href: '/help/work',
        },
        {
          label: 'Task boards',
          href: '/use-cases/task-board',
        },
      ],
    },
    diagram: {
      label: 'Illustrative example · fictional team',
      query: 'When is the pilot export due, and is it complete?',
      sources: [
        {
          provider: 'Meetings',
          stamp: 'Monday',
          signal: 'Mika agrees to send a pilot export Thursday.',
        },
        {
          provider: 'Email',
          stamp: 'Tuesday',
          signal: 'Customer accepts Friday instead.',
        },
        {
          provider: 'Slack',
          stamp: 'Thursday',
          signal: 'Mika says validation is still running.',
        },
      ],
      chronology: [
        'Mika agrees to send a pilot export Thursday.',
        'Customer accepts Friday instead.',
        'Mika says validation is still running.',
      ],
      answerTitle: 'Friday is agreed; completion is not recorded.',
      answerBody:
        'The email changes the commitment, while the Slack reply supports work in progress. Check the task history for an applied update or Approvals if it needs review.',
      citations: ['01', '02', '03'],
    },
    interpretation: {
      title: 'Track the commitment, not the number of reminders.',
      body: [
        'An action item is useful when another person can tell what result is owed, who owns it and what evidence would close it. Keep a short history when that agreement changes.',
      ],
    },
    limitations: [
      'Only captured and visible sources can support the answer.',
      'A transcript may contain speaker or date errors.',
      '“Done” in chat can describe a partial result; check the acceptance criteria.',
      'Dates suggested by the model are not agreed deadlines.',
    ],
    faqs: [
      {
        question: 'Should every meeting action become a task?',
        answer:
          'No. Record decisions, ideas and commitments separately. Create or accept a task when there is actionable work and enough evidence of responsibility.',
      },
      {
        question: 'What if two people appear to own the action?',
        answer:
          'Keep the ownership conflict visible and ask them to confirm a single accountable owner. Do not infer responsibility from who sent the most messages.',
      },
      {
        question: 'Does extracting action items update an external task tracker?',
        answer:
          'A retrieved answer does not write to a task tracker. Eligible Timeline updates can apply under workspace policy. Any external action uses that tool’s own permissions.',
      },
    ],
    relatedRoutes: [
      '/guides/software-project-handover-checklist-template',
      '/guides/weekly-engineering-updates-from-slack-linear-and-github',
    ],
    cta: {
      title: 'Try this with one project.',
      body: 'Start with sources you can share and a question you can verify. Inspect the supporting evidence before distributing the result.',
      label: 'Start free',
      href: '/sign-up',
    },
  },
  {
    slug: 'software-project-handover-checklist-template',
    route: '/guides/software-project-handover-checklist-template',
    title: 'Project handover checklist and template for software teams',
    shortTitle: 'Prepare a software project handover',
    summary:
      'Hand over a software project with a copyable checklist covering delivery state, decisions, access, operational ownership, blockers and the next commitments.',
    machineSummary:
      'Hand over a software project with a copyable checklist covering delivery state, decisions, access, operational ownership, blockers and the next commitments.',
    nativeConnectors: ['Slack', 'GitHub'],
    topics: ['Prepare a software project handover', 'templates', 'cited work records'],
    answer: {
      title: 'A handover is complete when the receiving owner can continue the work.',
      body: 'Prepare a brief with current scope, release state, owners, open decisions, risks, access requirements and immediate next steps. Link the supporting records, then have the receiving owner verify access and explain the next action back to you. A document alone does not establish readiness.',
      checklist: [
        'Name the outgoing and receiving owners.',
        'Separate merged, released and customer-verified work.',
        'List access checks without including credentials.',
        'Agree the next action and a support window.',
      ],
    },
    context: [
      'A generic project handover often lists files but omits why a decision was made or which release is actually live. Software teams need both operational readiness and the reasoning behind unfinished work.',
      'You can fill the template manually from your tracker, runbook and conversations. Timeline can assemble a cited draft from captured sources, but access checks, production verification and acceptance still require people.',
    ],
    workflow: [
      {
        index: '01',
        title: 'Fix the handover boundary',
        body: 'Name the project, scope, cutoff date, outgoing owner and receiving owner. Specify whether this is an internal ownership transfer, client delivery or temporary cover. List what is explicitly outside the handover.',
        output: 'A clear transfer of responsibility.',
      },
      {
        index: '02',
        title: 'Reconstruct delivery state',
        body: 'Collect the current task state, merged changes, release evidence and remaining blockers. Ask Timeline for a cited chronology or inspect the sources directly. Confirm the deployed version through the team’s trusted release process.',
        output: 'A status statement that separates code and delivery.',
      },
      {
        index: '03',
        title: 'Explain decisions and unresolved questions',
        body: 'Record important choices, alternatives rejected, customer commitments and pending approvals. Include the decision source and an owner for every open question. Distinguish the accepted record from a proposed change.',
        output: 'Context the receiving owner can challenge.',
      },
      {
        index: '04',
        title: 'Check operational access',
        body: 'Have the receiving owner verify repository, tracker, monitoring and runbook access using the normal access process. Record whether each check passed, not passwords, tokens or private invitation links. Verify escalation and rollback ownership.',
        output: 'An access checklist with gaps assigned.',
      },
      {
        index: '05',
        title: 'Walk through the next action',
        body: 'Ask the receiving owner to describe the next delivery step and the response to a realistic incident. Resolve ambiguities, agree an acknowledgement and define how long the outgoing owner remains available.',
        output: 'An accepted handover with a support window.',
      },
    ],
    boundaries: [
      {
        provider: 'Slack',
        role: 'Decisions and coordination',
        includes: 'Messages and threads captured from selected channels.',
        boundary:
          'Connect and activate only sources you can share. After capture, Timeline visibility governs access; it does not mirror every reader’s Slack membership.',
      },
      {
        provider: 'GitHub',
        role: 'Implementation evidence',
        includes:
          'Captured pull requests, reviews, releases and workflow results from selected repositories.',
        boundary:
          'Default-branch commit polling is bounded. A merge or successful workflow does not by itself establish a production deployment.',
      },
      {
        provider: 'Meetings',
        role: 'Discussion and assigned next steps',
        includes: 'Captured meeting transcripts and notes.',
        boundary:
          'Use an authorized transcript or a consent-gated meeting bot. A transcript can misattribute a speaker or miss a correction; verify important commitments.',
      },
    ],
    prompt:
      'Draft a handover for [project] as of [cutoff]. Include current delivery state, decisions, owners, blockers, pending approvals and next steps from captured sources. Cite each claim and list access checks and production facts that still require human verification.',
    toolkit: {
      title: 'Template and worked example',
      introduction:
        'Copy this template into a document or message. The filled example is illustrative; replace its source labels with links to your own evidence.',
      template:
        'Project / cutoff: [name + date + timezone]\nOutgoing owner → receiving owner: [names]\nScope and exclusions: [what transfers]\nDelivery: [merged / released / verified + evidence]\nKey decisions: [decision + rationale + source]\nOpen work: [action + owner + due date + status]\nCustomer commitments: [agreement + source]\nAccess checks: [repo / tracker / monitoring / runbook: verified or pending]\nOperations: [deployment, rollback and escalation owners]\nRisks / pending approvals: [items]\nNext action: [owner + action + date]\nAcceptance and support window: [acknowledgement + end date]',
      example:
        'Illustrative handover — Acme callback, 14 November\nOutgoing owner: Maya. Receiving owner: Priya.\nDelivery: PR merged [GitHub]; broad rollout held for SSO validation [Slack].\nDecision: Keep the pilot limited until validation [review call].\nOpen work: Priya to arrange the next validation run; date not yet agreed.\nAccess: Repo confirmed by Priya; monitoring access still pending.\nAcceptance: Pending monitoring access and next-run confirmation.\nSupport window: To be agreed with Maya. No production-readiness claim yet.',
      links: [
        {
          label: 'Onboarding and repeat questions',
          href: '/use-cases/onboarding-and-repeat-questions',
        },
        {
          label: 'Document capture and visibility',
          href: '/help/documents',
        },
        {
          label: 'GitHub delivery evidence',
          href: '/integrations/github',
        },
      ],
    },
    diagram: {
      label: 'Illustrative example · fictional team',
      query: 'What does Priya need to take over the Acme callback rollout?',
      sources: [
        {
          provider: 'GitHub',
          stamp: 'Wednesday',
          signal: 'Callback implementation merges.',
        },
        {
          provider: 'Slack',
          stamp: 'Thursday',
          signal: 'SSO validation keeps rollout on hold.',
        },
        {
          provider: 'Meetings',
          stamp: 'Friday',
          signal: 'Priya takes over validation planning.',
        },
      ],
      chronology: [
        'Callback implementation merges.',
        'SSO validation keeps rollout on hold.',
        'Priya takes over validation planning.',
      ],
      answerTitle: 'Ownership can transfer while rollout remains blocked.',
      answerBody:
        'Priya owns the next validation step; the receiving team still needs to verify operational access and agree timing.',
      citations: ['01', '02', '03'],
    },
    interpretation: {
      title: 'Make acceptance a concrete conversation.',
      body: [
        'A receiving owner should be able to locate the evidence, identify the next step and name the escalation path. If they cannot, the checklist has exposed useful work still to do.',
      ],
    },
    limitations: [
      'Uncaptured decisions remain missing even when the brief looks complete.',
      'Repository activity alone cannot confirm the deployed state.',
      'Document access does not imply monitoring or production access.',
      'A handover summary does not change ownership or approve pending proposals.',
    ],
    faqs: [
      {
        question: 'What belongs in a software project handover?',
        answer:
          'Include scope, owners, actual release state, key decisions, open work, access and operational checks, risks, next steps and acceptance. Link sources instead of copying every conversation.',
      },
      {
        question: 'Can I use this for a client handover?',
        answer:
          'Yes. Add contractual acceptance criteria and agreed deliverables, and remove internal or restricted content before sharing. Have the relevant owners confirm the client-facing version.',
      },
      {
        question: 'Can an AI-generated brief prove the project is ready?',
        answer:
          'No. It can organize captured evidence and flag gaps. The receiving owner must verify access, operational readiness and acceptance criteria.',
      },
    ],
    relatedRoutes: [
      '/guides/summarize-slack-channels',
      '/guides/weekly-engineering-updates-from-slack-linear-and-github',
    ],
    cta: {
      title: 'Try this with one project.',
      body: 'Start with sources you can share and a question you can verify. Inspect the supporting evidence before distributing the result.',
      label: 'Start free',
      href: '/sign-up',
    },
  },
  {
    slug: 'summarize-slack-channels',
    route: '/guides/summarize-slack-channels',
    title: 'How to summarize Slack channels: native summaries and cross-tool updates',
    shortTitle: 'Summarize Slack channels',
    summary:
      'Choose native Slack summaries, a manual recap or a cited cross-tool answer. Use a reusable summary prompt and check decisions, owners and unresolved questions.',
    machineSummary:
      'Choose native Slack summaries, a manual recap or a cited cross-tool answer. Use a reusable summary prompt and check decisions, owners and unresolved questions.',
    nativeConnectors: ['Slack', 'GitHub'],
    topics: ['Summarize Slack channels', 'templates', 'cited work records'],
    answer: {
      title: 'Start with the source boundary of your question.',
      body: 'For a conversation catch-up, try Slack’s built-in summary where your plan and administrator settings allow it. Review its source details. For a question that also needs email, call or delivery evidence, first check which sources your available tools can access, then generate a bounded answer and verify its citations.',
      checklist: [
        'Decide whether you need a channel recap or a project answer.',
        'Choose a date range and include relevant threads.',
        'Inspect the source behind consequential claims.',
        'Flag missing context and conflicting statements.',
      ],
    },
    context: [
      'A channel summary explains a conversation; a project update may need evidence that never appeared there. Slack offers native summaries and recaps, and some Slack features can also search connected sources. Check your workspace’s actual capabilities before adding another tool.',
      'Without AI summaries, read a bounded window and its threads, then write decisions, actions and unresolved questions with message links. The template below works for that manual method too.',
    ],
    workflow: [
      {
        index: '01',
        title: 'Try Slack’s native summary',
        body: 'On desktop, open the channel, use the conversation menu and choose the summary action if it is available. Choose the reporting period and inspect More details for sources. See Slack’s official guide for current controls and plan availability.',
        output: 'A native recap with source context.',
      },
      {
        index: '02',
        title: 'Decide whether the answer needs more sources',
        body: 'If your question asks what was discussed, the recap may be enough. If it asks whether a promise was fulfilled, identify the email, call, document or delivery record that would establish that. Check existing connected-source search before choosing another workflow.',
        output: 'A list of evidence needed to answer the question.',
      },
      {
        index: '03',
        title: 'Confirm Timeline’s capture scope',
        body: 'For a Timeline answer, connect and activate the Slack sources you can share, or use a linked capture channel. Add the authorized outside evidence separately. Check that the relevant records have arrived; connection alone does not make all history searchable.',
        output: 'Verified coverage for the chosen window.',
      },
      {
        index: '04',
        title: 'Ask for a structured summary',
        body: 'In Ask, name the project or channel, start and end times and desired sections. Ask for decisions, action owners and unknowns. The template can also guide a manual recap; it does not configure Slack’s native summary output.',
        output: 'A concise draft with explicit gaps.',
      },
      {
        index: '05',
        title: 'Read the thread behind each conclusion',
        body: 'Open the source and inspect replies that might qualify an early statement. A plan can change during the same thread. Correct unsupported claims and check the destination audience before sharing the summary.',
        output: 'A reviewed answer ready for its audience.',
      },
    ],
    boundaries: [
      {
        provider: 'Slack',
        role: 'Decisions and coordination',
        includes: 'Messages and threads captured from selected channels.',
        boundary:
          'Connect and activate only sources you can share. After capture, Timeline visibility governs access; it does not mirror every reader’s Slack membership.',
      },
      {
        provider: 'Email',
        role: 'Written commitments',
        includes: 'Email deliberately forwarded, CCed or BCCed to the team address.',
        boundary:
          'Timeline does not automatically read your whole inbox. Check recipients and source visibility before forwarding.',
      },
      {
        provider: 'GitHub',
        role: 'Implementation evidence',
        includes:
          'Captured pull requests, reviews, releases and workflow results from selected repositories.',
        boundary:
          'Default-branch commit polling is bounded. A merge or successful workflow does not by itself establish a production deployment.',
      },
    ],
    prompt:
      'Summarize [channel or project] from [start] to [end] in [timezone] using captured evidence. Return decisions, action items with owners, unresolved questions and delivery evidence. Cite claims and distinguish proposals from accepted decisions.',
    toolkit: {
      title: 'Template and worked example',
      introduction:
        'Copy this template into a document or message. The filled example is illustrative; replace its source labels with links to your own evidence.',
      template:
        'Channel / project: [name]\nWindow: [start → end + timezone]\nDecisions: [what was agreed + source]\nActions: [owner + next step + date / unknown]\nUnresolved questions: [question + who can resolve]\nDelivery evidence: [source, or not checked]\nMissing context: [uncaptured sources]\nReview: [claims checked + intended audience]',
      example:
        'Illustrative recap — Acme launch\nDiscussion: The team proposed a Friday rollout [Slack].\nCustomer condition: SSO validation must finish first [email].\nDelivery evidence: Callback PR merged; deployment not verified [GitHub].\nConclusion: Friday is a proposal with a dependency, not a confirmed launch.\nNext question: Who will confirm validation and the final release date?',
      links: [
        {
          label: 'Official Slack AI feature and summary guide',
          href: 'https://slack.com/help/articles/25076892548883-Guide-to-AI-features-in-Slack',
        },
        {
          label: 'Timeline Slack setup and limits',
          href: '/integrations/slack',
        },
        {
          label: 'Capture sources and inspect citations',
          href: '/help/capture',
        },
      ],
    },
    diagram: {
      label: 'Illustrative example · fictional team',
      query: 'Is the Acme launch confirmed for Friday?',
      sources: [
        {
          provider: 'Slack',
          stamp: 'Monday',
          signal: 'Friday rollout is proposed.',
        },
        {
          provider: 'Email',
          stamp: 'Tuesday',
          signal: 'Customer requires SSO validation first.',
        },
        {
          provider: 'GitHub',
          stamp: 'Wednesday',
          signal: 'Callback PR merges.',
        },
      ],
      chronology: [
        'Friday rollout is proposed.',
        'Customer requires SSO validation first.',
        'Callback PR merges.',
      ],
      answerTitle: 'A proposed date is not a confirmed release.',
      answerBody:
        'The channel plan has a customer dependency. The merge adds implementation evidence but does not establish deployment or approval.',
      citations: ['01', '02', '03'],
    },
    interpretation: {
      title: 'Choose the smallest workflow that answers the question.',
      body: [
        'A manual recap or native Slack summary can be enough. Use a broader captured record when the answer depends on evidence across sources, and keep the source limits visible.',
      ],
    },
    limitations: [
      'Slack feature names and availability can change; its official documentation owns those details.',
      'Timeline answers cover captured, visible evidence rather than all Slack history.',
      'A summary can omit nuance even when it includes citations.',
      'Neither message volume nor a recent statement proves that a decision was approved.',
    ],
    faqs: [
      {
        question: 'Can Slack summarize channels without another app?',
        answer:
          'Slack provides native conversation summaries and recaps on eligible plans, subject to role and administrator settings. Check its current feature guide for your workspace’s availability.',
      },
      {
        question: 'Can Slack search beyond messages?',
        answer:
          'Some Slack AI and enterprise search capabilities include connected sources. Availability and source access vary. Check your existing setup before assuming an extra tool is necessary.',
      },
      {
        question: 'Why might a summary miss a decision?',
        answer:
          'The decision may be outside the time window, in an uncaptured thread or source, or unavailable to the reader. It may also be an interpretation error. Inspect the original conversation before expanding access.',
      },
    ],
    relatedRoutes: [
      '/guides/automate-daily-team-updates-in-slack',
      '/guides/weekly-engineering-updates-from-slack-linear-and-github',
    ],
    cta: {
      title: 'Try this with one project.',
      body: 'Start with sources you can share and a question you can verify. Inspect the supporting evidence before distributing the result.',
      label: 'Start free',
      href: '/sign-up',
    },
  },
] as const satisfies readonly EditorialGuide[];
