import { Check, Circle, FileUp, Inbox, Plug, Send, StickyNote, X } from 'lucide-react';
import Link from 'next/link';

import type { onboarding } from '@timeline/shared';

import {
  dismissOnboardingChecklistAction,
  openOnboardingStepAction,
} from '@/app/actions/onboarding';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type ChecklistState = onboarding.OnboardingChecklistState;
type Step = onboarding.OnboardingStep;

const STEP_CONTENT: Record<
  Step,
  {
    title: string;
    detail: string;
    href: string;
    cta: string;
    icon: typeof StickyNote;
    markOnOpen: boolean;
  }
> = {
  first_note: {
    title: 'Capture first note',
    detail: 'Put one decision, follow-up, or meeting scrap into the timeline.',
    href: '#capture',
    cta: 'Start note',
    icon: StickyNote,
    markOnOpen: false,
  },
  telegram: {
    title: 'Connect Telegram',
    detail: 'Generate a personal or group link token for the team bot.',
    href: '/app/team/telegram',
    cta: 'Open Telegram',
    icon: Send,
    markOnOpen: true,
  },
  email_forwarding: {
    title: 'Set up email forwarding',
    detail: 'Open the team forwarding address and add it where mail starts.',
    href: '/app/team#email-ingest',
    cta: 'Open email setup',
    icon: Inbox,
    markOnOpen: true,
  },
  first_document: {
    title: 'Upload first document',
    detail: 'Open the drive and add a contract, policy, memo, or guide.',
    href: '/app/documents',
    cta: 'Open documents',
    icon: FileUp,
    markOnOpen: true,
  },
  first_integration: {
    title: 'Connect first integration',
    detail: 'Open the catalog for Drive, Linear, GitHub, or MCP servers.',
    href: '/app/team/integrations',
    cta: 'Open integrations',
    icon: Plug,
    markOnOpen: true,
  },
};

export function TimelineOnboardingChecklist({ state }: { state: ChecklistState }) {
  const completed = state.steps.filter((step) => step.completed).length;
  const total = state.steps.length;
  const allDone = completed === total;

  return (
    <section
      aria-label="Setup checklist"
      className="overflow-hidden rounded-sm border border-border bg-surface"
    >
      <div className="flex flex-wrap items-start gap-4 border-b border-border bg-bg px-4 py-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-mono text-[11px] uppercase tracking-[0.14em] text-fg">
              Setup checklist
            </h2>
            <span className="rounded-sm bg-signal-soft px-2 py-0.5 font-mono text-[11px] text-signal">
              {completed}/{total}
            </span>
          </div>
          <p className="mt-2 max-w-2xl text-sm text-fg-muted">
            {allDone
              ? 'The team tutorial is complete. Every teammate can still reopen it from the account menu.'
              : 'Try each capture surface once. Setup or opening the right surface counts; this is a tutorial, not an ingest audit.'}
          </p>
        </div>
        <form action={dismissOnboardingChecklistAction}>
          <Button type="submit" variant="ghost" size="icon" aria-label="Hide setup checklist">
            <X className="size-4" />
          </Button>
        </form>
      </div>

      <ol className="grid gap-px bg-border md:grid-cols-5">
        {state.steps.map((stepState) => {
          const content = STEP_CONTENT[stepState.step];
          const Icon = content.icon;
          return (
            <li key={stepState.step} className="bg-surface">
              <div
                className={cn(
                  'flex h-full flex-col gap-4 p-4',
                  stepState.completed ? 'text-fg' : 'text-fg-muted',
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <span
                    className={cn(
                      'grid size-8 shrink-0 place-items-center rounded-sm border',
                      stepState.completed
                        ? 'border-signal/40 bg-signal-soft text-signal'
                        : 'border-border bg-bg text-fg-dim',
                    )}
                  >
                    <Icon className="size-4" aria-hidden="true" />
                  </span>
                  {stepState.completed ? (
                    <Check className="size-4 shrink-0 text-signal" aria-label="Complete" />
                  ) : (
                    <Circle className="size-4 shrink-0 text-fg-dim" aria-label="Not complete" />
                  )}
                </div>

                <div className="min-w-0 space-y-1">
                  <h3 className="text-sm font-medium text-fg">{content.title}</h3>
                  <p className="text-xs leading-5 text-fg-muted">{content.detail}</p>
                </div>

                <div className="mt-auto">
                  {stepState.completed ? (
                    <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-signal">
                      Done
                    </span>
                  ) : content.markOnOpen ? (
                    <form action={openOnboardingStepAction}>
                      <input type="hidden" name="step" value={stepState.step} />
                      <input type="hidden" name="href" value={content.href} />
                      <Button type="submit" variant="outline" size="sm" className="w-full">
                        {content.cta}
                      </Button>
                    </form>
                  ) : (
                    <Button asChild variant="outline" size="sm" className="w-full">
                      <Link href={content.href}>{content.cta}</Link>
                    </Button>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
