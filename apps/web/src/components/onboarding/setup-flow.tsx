'use client';

import {
  setupProgressLabel,
  type FirstRunPhase,
  type FirstRunScanFailureReason,
  type TeamWorkStyle,
  type WebsiteSubject,
} from '@timeline/shared/onboarding/first-run';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';

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
import { ChooserScreen } from '@/components/onboarding/chooser-screen';
import { FailedScanScreen } from '@/components/onboarding/failed-scan-screen';
import { ProcessingScreen } from '@/components/onboarding/processing-screen';
import { SetupShell } from '@/components/onboarding/setup-shell';
import { WelcomeScreen } from '@/components/onboarding/welcome-screen';
import { pollFirstRun, type FirstRunStatusPayload } from '@/lib/first-run-poll';

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
  return 'Working on it';
}

export function SetupFlow({ initialStatus }: { initialStatus: FirstRunStatusPayload }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function recover(action: () => Promise<void>) {
    stopPolling.current?.();
    setError(null);
    startTransition(async () => {
      try {
        await action();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Could not continue. Please try again.');
      }
    });
  }
  const [polled, setPolled] = useState<{
    baseline: FirstRunStatusPayload;
    status: FirstRunStatusPayload;
  } | null>(null);
  const stopPolling = useRef<(() => void) | null>(null);
  const status = polled?.baseline === initialStatus ? polled.status : initialStatus;
  const firstRun = status.firstRun;
  const phase: FirstRunPhase = firstRun?.phase ?? 'welcome';
  const stepsFailed = status.record?.processingSteps.some((step) => step.status === 'failed');

  useEffect(() => {
    if (phase !== 'processing' || stepsFailed || pending) return;
    const stop = pollFirstRun(initialStatus, {
      update: (status) => {
        setPolled({ baseline: initialStatus, status });
      },
      navigate: (destination) => {
        router.replace(destination);
      },
      refresh: () => {
        router.refresh();
      },
    });
    stopPolling.current = stop;
    return stop;
  }, [initialStatus, pending, phase, router, stepsFailed]);

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

  async function skip() {
    const result = await skipFirstRunAction();
    if (!result.ok) throw new Error(result.error ?? 'Could not skip to Home.');
    router.replace('/app');
  }

  async function returnToChooser() {
    const result = await setFirstRunPhaseAction('choose');
    if (!result.ok) throw new Error(result.error ?? 'Could not return to the chooser.');
    router.refresh();
  }

  let body = (
    <WelcomeScreen
      teamName={status.teamName}
      inboundEmail={status.inboundEmail}
      initialWorkStyle={firstRun?.workStyle ?? null}
      onContinue={continueWorkStyle}
    />
  );
  if (phase === 'choose') {
    body = (
      <ChooserScreen
        inboundEmail={status.inboundEmail}
        onWebsite={pickWebsite}
        onDocument={pickDocument}
        onEmail={pickEmail}
        onSkip={skip}
      />
    );
  } else if (phase === 'failed') {
    body = (
      <FailedScanScreen
        host={firstRun?.websiteHost ?? null}
        reason={(firstRun?.scanFailureReason as FirstRunScanFailureReason | null) ?? null}
        onUpload={() => {
          recover(returnToChooser);
        }}
        onEmail={() => {
          recover(pickEmail);
        }}
        onBack={() => {
          recover(returnToChooser);
        }}
      />
    );
  } else if (phase === 'processing') {
    body = (
      <ProcessingScreen
        title={processingTitle(status)}
        description={
          firstRun?.starterPath === 'email'
            ? 'Send one real thread to your team address. This screen opens the record as soon as it arrives.'
            : 'You can leave this screen. The record also appears on Home when it is ready.'
        }
        steps={status.record?.processingSteps ?? []}
        inboundEmail={status.inboundEmail}
        emailWaiting={firstRun?.starterPath === 'email' && !status.record?.emailArrived}
        onSwitch={() => {
          recover(returnToChooser);
        }}
        onHome={() => {
          stopPolling.current?.();
          router.push('/app');
        }}
      />
    );
  }

  return (
    <SetupShell progress={setupProgressLabel(phase)}>
      {error ? (
        <p role="alert" className="mb-4 text-sm text-danger">
          {error}
        </p>
      ) : null}
      <fieldset disabled={pending} aria-busy={pending} className="min-w-0">
        {body}
      </fieldset>
    </SetupShell>
  );
}
