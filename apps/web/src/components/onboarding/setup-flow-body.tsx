'use client';

import {
  isConnectorStarterPath,
  type FirstRunPhase,
  type FirstRunScanFailureReason,
  type FirstRunState,
  type OnboardingSourceIntent,
  type TeamWorkStyle,
  type WebsiteSubject,
} from '@timeline/shared/onboarding/first-run';

import { ChooserScreen } from '@/components/onboarding/chooser-screen';
import { FailedScanScreen } from '@/components/onboarding/failed-scan-screen';
import { ProcessingScreen } from '@/components/onboarding/processing-screen';
import { WelcomeScreen } from '@/components/onboarding/welcome-screen';
import type { FirstRunStatusPayload } from '@/lib/first-run-poll';

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

function processingDescription(
  starterPath: FirstRunState['starterPath'] | null | undefined,
  connectorWaiting: OnboardingSourceIntent | null,
): string {
  if (starterPath === 'email') {
    return 'Send one real thread to your team address. This screen opens the record as soon as it arrives.';
  }
  if (connectorWaiting) {
    return 'Finish connecting, then send one message. This screen opens the record as soon as it lands.';
  }
  return 'You can leave this screen. The record also appears on Home when it is ready.';
}

function SetupProcessingBody({
  status,
  captureUrl,
  firstRun,
  telegramBotUsername,
  onSwitch,
  onHome,
}: {
  status: FirstRunStatusPayload;
  captureUrl: string | null;
  firstRun: FirstRunState | null | undefined;
  telegramBotUsername: string | null;
  onSwitch: () => void;
  onHome: () => void;
}) {
  const connectorWaiting =
    isConnectorStarterPath(firstRun?.starterPath) && !status.record?.emailArrived
      ? firstRun.starterPath
      : null;
  return (
    <ProcessingScreen
      title={processingTitle(status)}
      description={processingDescription(firstRun?.starterPath, connectorWaiting)}
      startedAt={firstRun?.starterSelectedAt ?? null}
      captureUrl={captureUrl}
      steps={status.record?.processingSteps ?? []}
      inboundEmail={status.inboundEmail}
      emailWaiting={firstRun?.starterPath === 'email' && !status.record?.emailArrived}
      connectorWaiting={connectorWaiting}
      telegramBotUsername={telegramBotUsername}
      onSwitch={onSwitch}
      onHome={onHome}
    />
  );
}

export function SetupFlowBody({
  status,
  captureUrl,
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
  onHome,
  onReturnToChooser,
  onPickEmail,
}: {
  status: FirstRunStatusPayload;
  captureUrl: string | null;
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
  onHome: () => void;
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
        firstRun={firstRun}
        telegramBotUsername={telegramBotUsername}
        onSwitch={onReturnToChooser}
        onHome={onHome}
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
