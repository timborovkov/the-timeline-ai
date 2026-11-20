'use client';

import {
  isConnectorStarterPath,
  type FirstRunPhase,
  type FirstRunScanFailureReason,
  type FirstRunState,
  type NamedProcessingStep,
  type OnboardingSourceIntent,
  type TeamWorkStyle,
  type WebsiteSubject,
} from '@timeline/shared/onboarding/first-run';

import { ChooserScreen } from '@/components/onboarding/chooser-screen';
import { FailedScanScreen } from '@/components/onboarding/failed-scan-screen';
import { ProcessingScreen } from '@/components/onboarding/processing-screen';
import { WelcomeScreen } from '@/components/onboarding/welcome-screen';

export interface FirstRunStatusPayload {
  firstRun: FirstRunState | null;
  inboundEmail: string | null;
  teamName: string;
  /** Workspace shown on Welcome; null when deferred solo create has no team yet. */
  teamId: string | null;
  record: {
    title: string;
    meta: string;
    processingSteps: NamedProcessingStep[];
    emailArrived: boolean;
  } | null;
}

function processingTitle(status: FirstRunStatusPayload): string {
  const path = status.firstRun?.starterPath;
  if (path === 'website') {
    return status.firstRun?.websiteHost
      ? `Reading ${status.firstRun.websiteHost}`
      : 'Reading your website';
  }
  if (path === 'document') {
    return status.record?.title ? `Reading ${status.record.title}` : 'Reading your document';
  }
  if (path === 'slack') return 'Waiting for Slack';
  if (path === 'telegram') return 'Waiting for Telegram';
  return 'Working on it';
}

function SetupProcessingBody({
  status,
  captureUrl,
  onLeave,
  firstRun,
  telegramBotUsername,
  onSwitch,
}: {
  status: FirstRunStatusPayload;
  captureUrl: string | null;
  onLeave: () => void;
  firstRun: FirstRunState | null | undefined;
  telegramBotUsername: string | null;
  onSwitch: () => void;
}) {
  const connectorWaiting =
    isConnectorStarterPath(firstRun?.starterPath) && !status.record?.emailArrived
      ? firstRun.starterPath
      : null;
  return (
    <ProcessingScreen
      title={processingTitle(status)}
      description="You can keep working on Home while this finishes. Open your capture status there to check progress."
      startedAt={firstRun?.starterSelectedAt ?? null}
      captureUrl={captureUrl}
      steps={status.record?.processingSteps ?? []}
      inboundEmail={status.inboundEmail}
      emailWaiting={firstRun?.starterPath === 'email' && !status.record?.emailArrived}
      connectorWaiting={connectorWaiting}
      telegramBotUsername={telegramBotUsername}
      onSwitch={onSwitch}
      onHome={onLeave}
    />
  );
}

export function SetupFlowBody({
  status,
  captureUrl,
  onLeave,
  phase,
  firstRun,
  preferredSource,
  connectors,
  telegramBotUsername,
  onContinueWorkStyle,
  onWebsite,
  onDocument,
  onEmail,
  onSlack,
  onTelegram,
  onSkip,
  onReturnToChooser,
  onPickEmail,
}: {
  status: FirstRunStatusPayload;
  captureUrl: string | null;
  onLeave: () => void;
  phase: FirstRunPhase;
  firstRun: FirstRunState | null | undefined;
  preferredSource: OnboardingSourceIntent | null;
  connectors: readonly OnboardingSourceIntent[];
  telegramBotUsername: string | null;
  onContinueWorkStyle: (workStyle: TeamWorkStyle | null, teamName: string) => Promise<void>;
  onWebsite: (
    url: string,
    websiteSubject: WebsiteSubject,
    websitePermissionConfirmed: boolean,
  ) => Promise<void>;
  onDocument: (file: File) => Promise<void>;
  onEmail: () => Promise<void>;
  onSlack?: () => Promise<void>;
  onTelegram?: () => Promise<void>;
  onSkip: () => Promise<void>;
  onReturnToChooser: () => void;
  onPickEmail: () => void;
}) {
  if (phase === 'choose') {
    return (
      <ChooserScreen
        inboundEmail={status.inboundEmail}
        connectors={connectors}
        preferredSource={preferredSource}
        telegramBotUsername={telegramBotUsername}
        onWebsite={onWebsite}
        onDocument={onDocument}
        onEmail={onEmail}
        onSlack={onSlack}
        onTelegram={onTelegram}
        onSkip={onSkip}
      />
    );
  }

  if (phase === 'failed') {
    return (
      <FailedScanScreen
        host={firstRun?.websiteHost ?? null}
        reason={(firstRun?.scanFailureReason as FirstRunScanFailureReason | null) ?? null}
        onUpload={onReturnToChooser}
        onEmail={onPickEmail}
        onBack={onReturnToChooser}
      />
    );
  }

  if (phase === 'processing') {
    return (
      <SetupProcessingBody
        status={status}
        captureUrl={captureUrl}
        onLeave={onLeave}
        firstRun={firstRun}
        telegramBotUsername={telegramBotUsername}
        onSwitch={onReturnToChooser}
      />
    );
  }

  return (
    <WelcomeScreen
      teamName={status.teamName}
      inboundEmail={status.inboundEmail}
      initialWorkStyle={firstRun?.workStyle ?? null}
      onContinue={onContinueWorkStyle}
    />
  );
}
