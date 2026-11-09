'use client';

import {
  setupProgressLabel,
  type FirstRunPhase,
  type FirstRunScanFailureReason,
  type FirstRunState,
  type NamedProcessingStep,
  type TeamWorkStyle,
} from '@timeline/shared/onboarding/first-run';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

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

export interface FirstRunStatusPayload {
  firstRun: FirstRunState | null;
  websiteScanEnabled: boolean;
  inboundEmail: string | null;
  teamName: string;
  record: {
    title: string;
    meta: string;
    processingSteps: NamedProcessingStep[];
    emailArrived: boolean;
  } | null;
}

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
  const firstRun = initialStatus.firstRun;
  const phase: FirstRunPhase = firstRun?.phase ?? 'welcome';

  useEffect(() => {
    if (phase !== 'processing') return;
    const id = setInterval(() => {
      router.refresh();
    }, 2500);
    return () => {
      clearInterval(id);
    };
  }, [phase, router]);

  async function continueWorkStyle(workStyle: TeamWorkStyle | null) {
    const result = await submitWorkStyleAction({ workStyle });
    if (!result.ok) throw new Error(result.error ?? 'Could not save how your team works.');
    router.refresh();
  }

  async function pickWebsite(url: string) {
    const result = await selectStarterPathAction({ path: 'website', websiteUrl: url });
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
      teamName={initialStatus.teamName}
      inboundEmail={initialStatus.inboundEmail}
      initialWorkStyle={firstRun?.workStyle ?? null}
      onContinue={continueWorkStyle}
    />
  );
  if (phase === 'choose') {
    body = (
      <ChooserScreen
        inboundEmail={initialStatus.inboundEmail}
        websiteScanEnabled={initialStatus.websiteScanEnabled}
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
          void returnToChooser();
        }}
        onEmail={() => {
          void pickEmail();
        }}
        onBack={() => {
          void returnToChooser();
        }}
      />
    );
  } else if (phase === 'processing') {
    body = (
      <ProcessingScreen
        title={processingTitle(initialStatus)}
        description={
          firstRun?.starterPath === 'email'
            ? 'Send one real thread to your team address. This screen opens the record as soon as it arrives.'
            : 'You can leave this screen. The record also appears on Home when it is ready.'
        }
        steps={initialStatus.record?.processingSteps ?? []}
        inboundEmail={initialStatus.inboundEmail}
        emailWaiting={firstRun?.starterPath === 'email' && !initialStatus.record?.emailArrived}
        onSwitch={() => {
          void returnToChooser();
        }}
        onHome={() => {
          router.push('/app');
        }}
      />
    );
  }

  return <SetupShell progress={setupProgressLabel(phase)}>{body}</SetupShell>;
}
