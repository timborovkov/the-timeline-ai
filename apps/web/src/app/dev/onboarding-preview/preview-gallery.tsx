'use client';

import {
  documentProcessingSteps,
  guidedAskEmptyHint,
  websiteProcessingSteps,
  type FirstRunPhase,
} from '@timeline/shared/onboarding/first-run';

import type { ReactNode } from 'react';

import { EmptyState } from '@/components/empty-state';
import { ChooserScreen } from '@/components/onboarding/chooser-screen';
import { FailedScanScreen } from '@/components/onboarding/failed-scan-screen';
import { FirstRecordScreen } from '@/components/onboarding/first-record-screen';
import { GettingStartedStrip } from '@/components/onboarding/getting-started-strip';
import { GoLiveScreen } from '@/components/onboarding/go-live-screen';
import { GuidedContinue } from '@/components/onboarding/guided-continue';
import { ProcessingScreen } from '@/components/onboarding/processing-screen';
import { SetupShell } from '@/components/onboarding/setup-shell';
import { SuggestionStatusPill } from '@/components/onboarding/suggestion-status-pill';
import { WelcomeScreen } from '@/components/onboarding/welcome-screen';

const noop = () => Promise.resolve();
const noopVoid = () => undefined;

const SOURCES = [
  { n: 1, kind: 'Document', title: 'Problem and offer', meta: 'chunk 1' },
  { n: 2, kind: 'Document', title: 'The ask', meta: 'chunk 2' },
  { n: 3, kind: 'Document', title: 'Pilots', meta: 'chunk 3' },
];

const SUGGESTIONS = [
  {
    id: 's1',
    type: 'Company',
    title: 'Northwind',
    detail: 'Pilot client',
    sourceN: 3,
    status: 'pending' as const,
  },
  {
    id: 's2',
    type: 'Person',
    title: 'Dana Reyes',
    detail: 'Founder',
    sourceN: 1,
    status: 'pending' as const,
  },
];

const WEBSITE_SUGGESTIONS = [
  {
    id: 's1',
    type: 'Company',
    title: 'Northwind',
    detail: 'Named client',
    sourceN: 2,
    status: 'pending' as const,
  },
  {
    id: 's2',
    type: 'Person',
    title: 'Dana Reyes',
    detail: 'Founder',
    sourceN: 2,
    status: 'pending' as const,
  },
];

function AppPreview({ phase, children }: { phase: FirstRunPhase; children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-bg text-fg">
      <header className="flex h-12 items-center border-b border-border px-4">
        <span className="text-sm font-semibold tracking-tight">The Timeline</span>
      </header>
      <GettingStartedStrip phase={phase} hidden={false} />
      <main className="flex-1 px-4 py-6 md:px-8 md:py-8">{children}</main>
    </div>
  );
}

function WelcomePreview({ inboundEmail }: { inboundEmail: string }) {
  return (
    <SetupShell progress="Setup · 1 of 2">
      <WelcomeScreen
        teamName="Noah Blake's Team"
        inboundEmail={inboundEmail}
        initialWorkStyle={null}
        onContinue={noop}
      />
    </SetupShell>
  );
}

function ChooserPreview({ inboundEmail }: { inboundEmail: string }) {
  return (
    <SetupShell progress="Setup · 2 of 2">
      <ChooserScreen
        inboundEmail={inboundEmail}
        onWebsite={noop}
        onDocument={noop}
        onEmail={noop}
        onSkip={noop}
      />
    </SetupShell>
  );
}

function ProcessingDocumentPreview({ inboundEmail }: { inboundEmail: string }) {
  return (
    <SetupShell progress="Setup · 2 of 2">
      <ProcessingScreen
        title="Reading Acme Studio seed deck.pdf"
        description="You can leave this screen. The record also appears on Home when it is ready."
        steps={documentProcessingSteps('extracting', false)}
        inboundEmail={inboundEmail}
        emailWaiting={false}
        onSwitch={noopVoid}
        onHome={noopVoid}
      />
    </SetupShell>
  );
}

function ProcessingEmailPreview({ inboundEmail }: { inboundEmail: string }) {
  return (
    <SetupShell progress="Setup · 2 of 2">
      <ProcessingScreen
        title="Waiting for your email"
        description="Send one real thread to your team address. This screen opens the record as soon as it arrives."
        steps={[]}
        inboundEmail={inboundEmail}
        emailWaiting
        onSwitch={noopVoid}
        onHome={noopVoid}
      />
    </SetupShell>
  );
}

function ProcessingWebsitePreview({ inboundEmail }: { inboundEmail: string }) {
  return (
    <SetupShell progress="Setup · 2 of 2">
      <ProcessingScreen
        title="Reading studio.example"
        description="You can leave this screen. The record also appears on Home when it is ready."
        steps={websiteProcessingSteps({
          host: 'studio.example',
          failureReason: null,
          pageCount: 2,
          hasSuggestions: false,
        })}
        inboundEmail={inboundEmail}
        emailWaiting={false}
        onSwitch={noopVoid}
        onHome={noopVoid}
      />
    </SetupShell>
  );
}

function FailedScanPreview({ reason }: { reason: 'no_readable_text' | 'robots' }) {
  return (
    <SetupShell progress="Setup · 2 of 2">
      <FailedScanScreen
        host="studio.example"
        reason={reason}
        onUpload={noopVoid}
        onEmail={noopVoid}
        onBack={noopVoid}
      />
    </SetupShell>
  );
}

function FirstRecordWebsitePreview() {
  return (
    <AppPreview phase="record">
      <FirstRecordScreen
        title="Starter context from studio.example"
        meta="Website · 2 pages read"
        summary="Studio designs product sprints for B2B software teams. The about page names Dana Reyes as founder and lists Northwind and Globex as clients."
        note="This is your public website, not your team’s work yet. The record starts updating itself once a channel or your email is connected."
        sources={[
          { n: 1, kind: 'Web page', title: 'Studio', meta: 'studio.example' },
          { n: 2, kind: 'Web page', title: 'About', meta: 'studio.example' },
        ]}
        suggestions={WEBSITE_SUGGESTIONS}
      />
    </AppPreview>
  );
}

function FirstRecordPreview() {
  return (
    <AppPreview phase="record">
      <FirstRecordScreen
        title="Acme Studio seed deck.pdf"
        meta="Document · uploaded just now"
        summary="The deck pitches Acme Studio's design sprints to B2B software teams and asks for a seed round to hire two designers. It names Northwind and Globex as pilot clients and lists Dana Reyes as founder."
        note="A document is a snapshot. The record starts updating itself once a channel or your email is connected."
        sources={SOURCES}
        suggestions={SUGGESTIONS}
      />
    </AppPreview>
  );
}

function GuidedAskPreview() {
  return (
    <AppPreview phase="ask">
      <p className="text-xs text-fg-dim">Ask</p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">
        Ask about what you just brought
      </h1>
      <p className="mt-2 text-sm leading-6 text-fg-muted">{guidedAskEmptyHint('document')}</p>
      <div className="mt-4 rounded-md border border-border bg-surface px-3 py-2 text-sm">
        What is this document about, and who does it name?
      </div>
      <p className="mt-3 text-xs text-fg-dim">Try asking</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <span className="rounded-full border border-border px-3 py-1 text-xs">
          Who is mentioned, and in what role?
        </span>
        <span className="rounded-full border border-border px-3 py-1 text-xs">
          What should happen next?
        </span>
      </div>
      <GuidedContinue
        phase="approve"
        href="/app/approvals"
        label="Review suggestions"
        hint="Every claim links to its source."
      />
    </AppPreview>
  );
}

function ApprovalsPreview() {
  return (
    <AppPreview phase="approve">
      <h1 className="text-2xl font-semibold tracking-tight">Approvals</h1>
      <p className="mt-2 text-sm leading-6 text-fg-muted">
        Nothing becomes a lasting record until you accept it. Rejecting removes the suggestion; the
        source stays in your event history either way.
      </p>
      <p className="mt-4 text-xs text-fg-dim">Approvals · from this capture</p>
      <ul className="mt-2 border-t border-border">
        {SUGGESTIONS.map((suggestion) => (
          <li
            key={suggestion.id}
            className="flex flex-wrap items-center gap-3 border-b border-border py-2.5"
          >
            <span className="w-14 text-xs text-fg-dim">{suggestion.type}</span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">{suggestion.title}</div>
              <div className="mt-0.5 text-xs text-fg-dim">{suggestion.detail}</div>
            </div>
            <SuggestionStatusPill status={suggestion.status} />
          </li>
        ))}
      </ul>
      <GuidedContinue
        phase="live"
        href="/app/onboarding/live"
        label="Continue"
        hint="Anything you leave stays in Work → Approvals."
      />
    </AppPreview>
  );
}

function GoLivePreview({ inboundEmail }: { inboundEmail: string }) {
  return (
    <AppPreview phase="live">
      <GoLiveScreen workStyle="email" inboundEmail={inboundEmail} digestEnabled={false} />
    </AppPreview>
  );
}

function SkipEmptyPreview() {
  return (
    <div className="flex min-h-dvh flex-col bg-bg text-fg">
      <header className="flex h-12 items-center border-b border-border px-4">
        <span className="text-sm font-semibold tracking-tight">The Timeline</span>
      </header>
      <main className="flex-1 px-4 py-6 md:px-8 md:py-8">
        <h1 className="sr-only">Home</h1>
        <EmptyState
          title="Your timeline is empty"
          body="Your timeline fills from what your team captures. Forward an email, upload a document or connect a channel to start it."
          href="/onboarding"
          action="Bring something real"
        />
      </main>
    </div>
  );
}

const SCREEN_NAMES = [
  'welcome',
  'chooser',
  'chooser-enabled',
  'processing-document',
  'processing-email',
  'processing-website',
  'failed-scan',
  'failed-scan-robots',
  'first-record',
  'first-record-website',
  'guided-ask',
  'approvals',
  'go-live',
  'skip-empty',
] as const;

const SCREENS: Record<string, (inboundEmail: string) => ReactNode> = {
  welcome: (inboundEmail) => <WelcomePreview inboundEmail={inboundEmail} />,
  chooser: (inboundEmail) => <ChooserPreview inboundEmail={inboundEmail} />,
  'chooser-enabled': (inboundEmail) => <ChooserPreview inboundEmail={inboundEmail} />,
  'processing-document': (inboundEmail) => (
    <ProcessingDocumentPreview inboundEmail={inboundEmail} />
  ),
  'processing-email': (inboundEmail) => <ProcessingEmailPreview inboundEmail={inboundEmail} />,
  'processing-website': (inboundEmail) => <ProcessingWebsitePreview inboundEmail={inboundEmail} />,
  'failed-scan': () => <FailedScanPreview reason="no_readable_text" />,
  'failed-scan-robots': () => <FailedScanPreview reason="robots" />,
  'first-record': () => <FirstRecordPreview />,
  'first-record-website': () => <FirstRecordWebsitePreview />,
  'guided-ask': () => <GuidedAskPreview />,
  approvals: () => <ApprovalsPreview />,
  'go-live': (inboundEmail) => <GoLivePreview inboundEmail={inboundEmail} />,
  'skip-empty': () => <SkipEmptyPreview />,
};

export function OnboardingPreviewGallery({
  screen,
  inboundEmail,
}: {
  screen: string;
  inboundEmail: string;
}) {
  const render = SCREENS[screen];
  if (!render) {
    return (
      <div className="p-8 text-sm text-fg-muted">
        Unknown screen. Use ?screen={SCREEN_NAMES.join('|')}
      </div>
    );
  }
  return render(inboundEmail);
}
