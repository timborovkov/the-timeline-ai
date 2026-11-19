'use client';

import {
  isConnectorStarterPath,
  setupProgressLabel,
  type FirstRunPhase,
  type OnboardingSourceIntent,
  type TeamWorkStyle,
  type WebsiteSubject,
} from '@timeline/shared/onboarding/first-run';
import { useRouter } from 'next/navigation';
import { useEffect, useEffectEvent, useRef, useState, useTransition } from 'react';

import {
  finalizeDocumentVersionAction,
  requestDocumentUploadAction,
} from '@/app/actions/documents';
import {
  attachOnboardingDocumentAction,
  selectStarterPathAction,
  setFirstRunPhaseAction,
  skipFirstRunAction,
  submitWorkStyleAction,
} from '@/app/actions/first-run';
import { SetupFlowBody, type FirstRunStatusPayload } from '@/components/onboarding/setup-flow-body';
import { SetupShell } from '@/components/onboarding/setup-shell';

export type { FirstRunStatusPayload };

async function uploadOnboardingDocument(file: File): Promise<void> {
  const contentType = file.type || 'application/octet-stream';
  const req = await requestDocumentUploadAction({
    name: file.name,
    filename: file.name,
    contentType,
    visibility: 'team',
    visibilityUserIds: [],
  });
  if (!req.ok || !req.url || !req.versionId) {
    throw new Error(req.error ?? 'Upload request failed');
  }
  const put = await fetch(req.url, {
    method: 'PUT',
    headers: { 'content-type': contentType },
    body: file,
  });
  if (!put.ok) throw new Error(`Upload failed: ${String(put.status)}`);
  const finalized = await finalizeDocumentVersionAction({ versionId: req.versionId });
  if (!finalized.ok || !finalized.documentId) {
    throw new Error(finalized.error ?? 'Finalize failed');
  }
  const attached = await attachOnboardingDocumentAction({ documentId: finalized.documentId });
  if (!attached.ok) throw new Error(attached.error ?? 'Could not attach the document.');
}

const EMPTY_CONNECTORS: readonly OnboardingSourceIntent[] = [];

export function SetupFlow({
  initialStatus,
  preferredSource = null,
  connectors = EMPTY_CONNECTORS,
  telegramBotUsername = null,
}: {
  initialStatus: FirstRunStatusPayload;
  preferredSource?: OnboardingSourceIntent | null;
  connectors?: readonly OnboardingSourceIntent[];
  telegramBotUsername?: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const intentStarted = useRef(false);
  const firstRun = initialStatus.firstRun;
  const phase: FirstRunPhase = firstRun?.phase ?? 'welcome';
  const shouldAutoStart =
    phase === 'choose' && preferredSource != null && connectors.includes(preferredSource);
  // Lock the chooser on first paint for marketing-intent auto-start; recover alone
  // only flips pending on the next render after useEffect.
  const [autoStartSettled, setAutoStartSettled] = useState(!shouldAutoStart);

  function recover(action: () => Promise<void>) {
    setError(null);
    startTransition(async () => {
      try {
        await action();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Could not continue. Please try again.');
      }
    });
  }

  const stepsFailed = (initialStatus.record?.processingSteps ?? []).some(
    (step) => step.status === 'failed',
  );
  const waitingForCapture =
    phase === 'processing' &&
    (firstRun?.starterPath === 'email' || isConnectorStarterPath(firstRun?.starterPath)) &&
    !initialStatus.record?.emailArrived;
  const saving = pending || (shouldAutoStart && !autoStartSettled);

  useEffect(() => {
    if ((phase !== 'processing' || stepsFailed) && !waitingForCapture) return;
    const id = setInterval(() => {
      router.refresh();
    }, 2500);
    return () => {
      clearInterval(id);
    };
  }, [phase, router, stepsFailed, waitingForCapture]);

  useEffect(() => {
    setAutoStartSettled(!shouldAutoStart);
  }, [shouldAutoStart]);

  const startPreferredConnector = useEffectEvent(() => {
    if (!shouldAutoStart || intentStarted.current || !preferredSource) return;
    intentStarted.current = true;
    // Run through recover so pending/error handling matches other setup saves.
    recover(async () => {
      try {
        const result = await selectStarterPathAction({ path: preferredSource });
        if (!result.ok) {
          intentStarted.current = false;
          throw new Error(result.error ?? 'Could not start that connector.');
        }
        router.refresh();
      } finally {
        setAutoStartSettled(true);
      }
    });
  });

  useEffect(() => {
    startPreferredConnector();
  }, [shouldAutoStart, preferredSource, connectors]);

  async function continueWorkStyle(workStyle: TeamWorkStyle | null, teamName: string) {
    const result = await submitWorkStyleAction({
      workStyle,
      teamName,
      teamId: initialStatus.teamId,
    });
    if (!result.ok) throw new Error(result.error ?? 'Could not save how your team works.');
    router.refresh();
  }

  async function pickWebsite(
    url: string,
    websiteSubject: WebsiteSubject,
    websitePermissionConfirmed: boolean,
  ) {
    const result = await selectStarterPathAction({
      path: 'website',
      websiteUrl: url,
      websiteSubject,
      websitePermissionConfirmed,
    });
    if (!result.ok) throw new Error(result.error ?? 'Could not start the website scan.');
    router.refresh();
  }

  async function pickDocument(file: File) {
    await uploadOnboardingDocument(file);
    router.refresh();
  }

  async function pickEmail() {
    const result = await selectStarterPathAction({ path: 'email' });
    if (!result.ok) throw new Error(result.error ?? 'Could not start email capture.');
    router.refresh();
  }

  async function pickSlack() {
    const result = await selectStarterPathAction({ path: 'slack' });
    if (!result.ok) throw new Error(result.error ?? 'Could not start Slack capture.');
    router.refresh();
  }

  async function pickTelegram() {
    const result = await selectStarterPathAction({ path: 'telegram' });
    if (!result.ok) throw new Error(result.error ?? 'Could not start Telegram capture.');
    router.refresh();
  }

  async function skip() {
    const result = await skipFirstRunAction();
    if (!result.ok) throw new Error(result.error ?? 'Could not skip to Home.');
    router.replace('/app');
  }

  async function returnToChooser() {
    const result = await setFirstRunPhaseAction('choose');
    if (!result.ok) throw new Error(result.error ?? 'Could not return to the chooser.');
    // Drop marketing ?source= so a refresh does not re-auto-start the connector path.
    router.replace('/onboarding');
  }

  return (
    <SetupShell progress={setupProgressLabel(phase)}>
      {error ? (
        <p role="alert" className="mb-4 text-sm text-danger">
          {error}
        </p>
      ) : null}
      <fieldset disabled={saving} aria-busy={saving} className="min-w-0">
        <SetupFlowBody
          status={initialStatus}
          phase={phase}
          firstRun={firstRun}
          preferredSource={preferredSource}
          connectors={connectors}
          telegramBotUsername={telegramBotUsername}
          onContinueWorkStyle={continueWorkStyle}
          onWebsite={pickWebsite}
          onDocument={pickDocument}
          onEmail={pickEmail}
          onSlack={connectors.includes('slack') ? pickSlack : undefined}
          onTelegram={connectors.includes('telegram') ? pickTelegram : undefined}
          onSkip={skip}
          onReturnToChooser={() => {
            recover(returnToChooser);
          }}
          onPickEmail={() => {
            recover(pickEmail);
          }}
        />
      </fieldset>
    </SetupShell>
  );
}
