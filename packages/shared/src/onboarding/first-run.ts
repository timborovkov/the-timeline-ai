export const TEAM_WORK_STYLES = ['email', 'chat', 'dealflow', 'delivery', 'other'] as const;
export type TeamWorkStyle = (typeof TEAM_WORK_STYLES)[number];

export const FIRST_RUN_PHASES = [
  'welcome',
  'choose',
  'processing',
  'record',
  'ask',
  'approve',
  'live',
  'complete',
  'skipped',
  'failed',
] as const;
export type FirstRunPhase = (typeof FIRST_RUN_PHASES)[number];

export const FIRST_RUN_PATHS = ['website', 'document', 'email', 'skip'] as const;
export type FirstRunPath = (typeof FIRST_RUN_PATHS)[number];

export type FirstRunScanFailureReason =
  'no_readable_text' | 'robots' | 'unreachable' | 'not_enabled' | 'rate_limited';

export type GoLiveChannel = 'slack' | 'telegram' | 'email' | 'digest' | 'meeting';

export const GETTING_STARTED_STEPS = ['capture', 'ask', 'approve', 'live'] as const;
export type GettingStartedStep = (typeof GETTING_STARTED_STEPS)[number];

export const WEBSITE_SCAN_PAGE_CAP = 5;
export const ONBOARDING_DOCUMENT_MAX_BYTES = 25 * 1024 * 1024;

export interface WorkStyleOption {
  id: TeamWorkStyle;
  label: string;
  recommendedChannel: Exclude<GoLiveChannel, 'digest' | 'meeting'> | null;
}

export const WORK_STYLE_OPTIONS: readonly WorkStyleOption[] = [
  {
    id: 'email',
    label: 'Lots of client conversations happen over email',
    recommendedChannel: 'email',
  },
  {
    id: 'chat',
    label: "We're chat-first in Slack or Telegram",
    recommendedChannel: 'slack',
  },
  {
    id: 'dealflow',
    label: 'We run a dealflow or investor pipeline',
    recommendedChannel: 'email',
  },
  {
    id: 'delivery',
    label: 'We deliver projects for clients',
    recommendedChannel: 'slack',
  },
  {
    id: 'other',
    label: 'Something else',
    recommendedChannel: null,
  },
];

export const SETUP_SHELL_PHASES: readonly FirstRunPhase[] = [
  'welcome',
  'choose',
  'processing',
  'failed',
];
const GUIDED_SHELL_PHASES: readonly FirstRunPhase[] = ['record', 'ask', 'approve', 'live'];

export interface FirstRunState {
  teamId: string;
  startedByUserId: string | null;
  phase: FirstRunPhase;
  starterPath: FirstRunPath | null;
  starterSelectedAt: Date | null;
  captureDocumentId: string | null;
  captureEventId: string | null;
  websiteUrl: string | null;
  websiteHost: string | null;
  scanFailureReason: FirstRunScanFailureReason | null;
  guideHiddenAt: Date | null;
  firstCaptureLandedAt: Date | null;
  workStyle: TeamWorkStyle | null;
  createdAt: Date;
  updatedAt: Date;
}

type ProcessingStepStatus = 'done' | 'active' | 'waiting' | 'failed';

export interface NamedProcessingStep {
  id: string;
  label: string;
  status: ProcessingStepStatus;
  detail?: string;
}

export interface FirstRunSource {
  n: number;
  kind: string;
  title: string;
  meta: string;
  href?: string;
}

export interface FirstRunSuggestion {
  id: string;
  type: string;
  title: string;
  detail: string;
  sourceN: number | null;
  status: 'pending' | 'accepted' | 'rejected' | 'updated';
}

export function isWebsiteScanEnabled(env: { WEBSITE_SCAN_ENABLED?: boolean | string }): boolean {
  const value = env.WEBSITE_SCAN_ENABLED;
  return value === true || value === 'true' || value === '1';
}

export function recommendedGoLiveChannel(
  workStyle: TeamWorkStyle | null | undefined,
): WorkStyleOption['recommendedChannel'] {
  if (!workStyle) return null;
  return WORK_STYLE_OPTIONS.find((option) => option.id === workStyle)?.recommendedChannel ?? null;
}

export function setupProgressLabel(phase: FirstRunPhase): string {
  return phase === 'welcome' ? 'Setup · 1 of 2' : 'Setup · 2 of 2';
}

export function gettingStartedIndex(phase: FirstRunPhase): number {
  if (phase === 'record') return 0;
  if (phase === 'ask') return 1;
  if (phase === 'approve') return 2;
  if (phase === 'live') return 3;
  return -1;
}

export function shouldRedirectToSetup(input: {
  firstRun: FirstRunState | null;
  userId: string;
}): boolean {
  if (!input.firstRun) return false;
  if (input.firstRun.startedByUserId !== input.userId) return false;
  return input.firstRun.phase === 'welcome' || input.firstRun.phase === 'choose';
}

export function canReplaceFirstRunStarter(
  current: { phase: FirstRunPhase; starterPath: FirstRunPath | null } | null | undefined,
  nextPath: FirstRunPath,
): boolean {
  if (!current) return true;
  if (current.starterPath === nextPath) return true;
  return current.phase === 'welcome' || current.phase === 'choose' || current.phase === 'failed';
}

export function firstCaptureJustLanded(
  before: Pick<FirstRunState, 'firstCaptureLandedAt' | 'starterPath'> | null | undefined,
  after: Pick<FirstRunState, 'firstCaptureLandedAt' | 'starterPath'> | null | undefined,
): Exclude<FirstRunPath, 'skip'> | null {
  if (!after?.firstCaptureLandedAt || before?.firstCaptureLandedAt) return null;
  if (
    after.starterPath === 'document' ||
    after.starterPath === 'email' ||
    after.starterPath === 'website'
  ) {
    return after.starterPath;
  }
  return null;
}

export function shouldShowGettingStartedStrip(input: {
  phase: FirstRunPhase | null;
  hidden: boolean;
  pathname: string;
}): boolean {
  if (!input.phase || input.hidden) return false;
  if (!GUIDED_SHELL_PHASES.includes(input.phase)) return false;
  if (input.pathname === '/app') return false;
  return true;
}

function captureChecklistKey(path: FirstRunPath | null): string {
  if (path === 'document') return 'first_document';
  if (path === 'email') return 'email_forwarding';
  return 'first_note';
}

function captureChecklistLabel(path: FirstRunPath | null): string {
  if (path === 'document') return 'Upload a document';
  if (path === 'email') return 'Forward email into the timeline';
  if (path === 'website') return 'Scan your website';
  return 'Capture one timeline event';
}

export function prefilledAskQuestion(input: {
  path: FirstRunPath | null;
  workStyle: TeamWorkStyle | null;
  recordTitle?: string | null;
}): string {
  if (input.path === 'email') {
    return 'What did this thread ask for, and who owns the next step?';
  }
  if (input.path === 'website') {
    return 'What does this site say the company offers, and who is named?';
  }
  if (input.path === 'document') {
    if (input.workStyle === 'dealflow') {
      return 'What is this document asking for, and who are the named counterparts?';
    }
    return 'What is this document about, and who does it name?';
  }
  return input.recordTitle
    ? `What should I know from ${input.recordTitle}?`
    : 'What should happen next?';
}

export const TRY_ASKING_PROMPTS = [
  'Who is mentioned, and in what role?',
  'What should happen next?',
] as const;

type DocumentProcessingStatus =
  'pending' | 'extracting' | 'chunked' | 'embedded' | 'deferred' | 'failed';

export function documentProcessingSteps(
  status: DocumentProcessingStatus | null,
  hasSuggestions: boolean,
): NamedProcessingStep[] {
  const rank: Record<DocumentProcessingStatus, number> = {
    pending: 1,
    extracting: 2,
    deferred: 2,
    failed: 2,
    chunked: 3,
    embedded: 4,
  };
  const current = status ? rank[status] : 1;
  const extractingFailed = status === 'failed';
  const extractingDetail =
    status === 'deferred'
      ? 'Extraction is waiting to run.'
      : extractingFailed
        ? 'We could not extract text from this file.'
        : 'PDF and Office files up to 25 MB.';
  return [
    { id: 'upload', label: 'Uploading', status: current > 1 ? 'done' : 'active' },
    {
      id: 'extract',
      label: 'Extracting text',
      status: extractingFailed
        ? 'failed'
        : current > 2
          ? 'done'
          : current === 2
            ? 'active'
            : 'waiting',
      detail: extractingDetail,
    },
    {
      id: 'index',
      label: 'Indexing it for search and citations',
      status: current > 3 ? 'done' : current === 3 ? 'active' : 'waiting',
    },
    {
      id: 'suggest',
      label: 'Suggesting people, companies and projects',
      status: hasSuggestions ? 'done' : current >= 4 ? 'active' : 'waiting',
    },
  ];
}

export function websiteProcessingSteps(input: {
  host: string | null;
  failureReason: FirstRunScanFailureReason | null;
  pageCount: number;
  hasSuggestions: boolean;
}): NamedProcessingStep[] {
  if (input.failureReason) {
    const checkDetail =
      input.failureReason === 'unreachable'
        ? 'The site did not respond in time.'
        : input.failureReason === 'robots'
          ? 'The site asked us not to read it.'
          : null;
    const homeDetail =
      input.failureReason === 'no_readable_text'
        ? 'The pages loaded, but they had no readable text.'
        : null;
    return [
      {
        id: 'check',
        label: 'Checking the address',
        status: input.failureReason === 'unreachable' ? 'failed' : 'done',
        ...(checkDetail ? { detail: checkDetail } : {}),
      },
      {
        id: 'home',
        label: 'Reading the home page',
        status: input.failureReason === 'no_readable_text' ? 'failed' : 'waiting',
        ...(homeDetail ? { detail: homeDetail } : {}),
      },
      {
        id: 'pages',
        label: 'Reading about, services and team pages',
        status: 'waiting',
        detail: `Up to ${String(WEBSITE_SCAN_PAGE_CAP)} public pages. Nothing behind a login.`,
      },
      { id: 'save', label: 'Saving each page as cited evidence', status: 'waiting' },
      { id: 'suggest', label: 'Suggesting people, companies and projects', status: 'waiting' },
    ];
  }
  const readingPages = input.pageCount > 1;
  return [
    { id: 'check', label: 'Checking the address', status: 'done', detail: 'The site responds.' },
    {
      id: 'home',
      label: 'Reading the home page',
      status: readingPages ? 'done' : 'active',
    },
    {
      id: 'pages',
      label: 'Reading about, services and team pages',
      status: readingPages ? 'active' : 'waiting',
      detail: `Up to ${String(WEBSITE_SCAN_PAGE_CAP)} public pages. Nothing behind a login.`,
    },
    { id: 'save', label: 'Saving each page as cited evidence', status: 'waiting' },
    {
      id: 'suggest',
      label: 'Suggesting people, companies and projects',
      status: input.hasSuggestions ? 'done' : 'waiting',
    },
  ];
}

export function scanFailureCopy(input: {
  host: string | null;
  reason: FirstRunScanFailureReason | null;
}): { title: string; body: string } {
  const host = input.host ?? 'that address';
  if (input.reason === 'robots') {
    return {
      title: `We couldn't read ${host}`,
      body: 'The site asked automated readers not to fetch those pages. Nothing was saved from this attempt.',
    };
  }
  if (input.reason === 'unreachable') {
    return {
      title: `We couldn't reach ${host}`,
      body: 'The address did not respond, or it is not a public site we can fetch. Nothing was saved from this attempt.',
    };
  }
  if (input.reason === 'rate_limited') {
    return {
      title: `We couldn't read ${host}`,
      body: 'This team already used its signup website scan. Upload a document or forward an email instead. Nothing new was saved.',
    };
  }
  if (input.reason === 'not_enabled') {
    return {
      title: 'Website scan is not available yet',
      body: 'Scan is coming soon. Upload a document or forward an email to start a cited record. Nothing was saved from this attempt.',
    };
  }
  return {
    title: `We couldn't read ${host}`,
    body: 'The pages loaded, but they had no readable text. Sites built entirely with JavaScript often look empty to us. Nothing was saved from this attempt.',
  };
}

function isNonPublicWebsiteHost(host: string): boolean {
  if (!host || host === 'localhost' || host === '::1') return true;
  if (host.endsWith('.local') || host.endsWith('.internal')) return true;
  if (host.includes(':')) {
    if (host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd')) return true;
  }
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!ipv4) return false;
  const a = Number(ipv4[1]);
  const b = Number(ipv4[2]);
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

export function parsePublicWebsiteUrl(
  raw: string,
): { href: string; host: string } | { error: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { error: 'Enter a public website address.' };
  let parsed: URL;
  try {
    parsed = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
  } catch {
    return { error: 'Enter a valid public website address.' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { error: 'Enter an http or https address.' };
  }
  const host = parsed.hostname.toLowerCase();
  if (isNonPublicWebsiteHost(host)) {
    return { error: 'Enter a public website, not a local address.' };
  }
  parsed.hash = '';
  return { href: parsed.toString(), host };
}

const WORK_STYLE_TYPE_RANK: Record<TeamWorkStyle, readonly string[]> = {
  email: ['person', 'company', 'task', 'deal', 'project'],
  chat: ['person', 'project', 'task', 'company', 'deal'],
  dealflow: ['deal', 'company', 'person', 'task', 'project'],
  delivery: ['project', 'task', 'person', 'company', 'deal'],
  other: ['person', 'company', 'project', 'task', 'deal'],
};

export function suggestionTypeRank(workStyle: TeamWorkStyle | null, type: string): number {
  const order = workStyle ? WORK_STYLE_TYPE_RANK[workStyle] : WORK_STYLE_TYPE_RANK.other;
  const index = order.indexOf(type.toLowerCase());
  return index === -1 ? order.length : index;
}

export function orderChecklistItems<T extends { key: string; label: string }>(
  items: T[],
  path: FirstRunPath | null,
): T[] {
  const captureKey = captureChecklistKey(path);
  const captureLabel = captureChecklistLabel(path);
  const preferred = [captureKey, 'first_ask', 'review_proposal'];
  const rank = (key: string) => {
    const index = preferred.indexOf(key);
    return index === -1 ? preferred.length : index;
  };
  return [...items]
    .map((item) => (item.key === captureKey ? { ...item, label: captureLabel } : item))
    .sort((a, b) => rank(a.key) - rank(b.key));
}
