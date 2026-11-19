'use client';

import {
  orderChooserSources,
  type ChooserSourceId,
  type OnboardingSourceIntent,
  type WebsiteSubject,
} from '@timeline/shared/onboarding/first-run';
import { FileUp, Globe, Mail, MessageSquare, Send, ArrowRight } from 'lucide-react';
import { useRef, useState, useTransition } from 'react';

import {
  DocumentChooserPanel,
  EmailChooserPanel,
  SlackChooserPanel,
  TelegramChooserPanel,
  WebsiteChooserPanel,
} from '@/components/onboarding/chooser-source-panels';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const SOURCE_META: Record<ChooserSourceId, { label: string; icon: typeof FileUp }> = {
  slack: { label: 'Slack', icon: MessageSquare },
  telegram: { label: 'Telegram', icon: Send },
  document: { label: 'Document', icon: FileUp },
  email: { label: 'Email', icon: Mail },
  website: { label: 'Website', icon: Globe },
};

const EMPTY_CONNECTORS: readonly OnboardingSourceIntent[] = [];

export function ChooserScreen({
  inboundEmail,
  connectors = EMPTY_CONNECTORS,
  preferredSource = null,
  telegramBotUsername = null,
  onWebsite,
  onDocument,
  onEmail,
  onSlack,
  onTelegram,
  onSkip,
}: {
  inboundEmail: string | null;
  connectors?: readonly OnboardingSourceIntent[];
  preferredSource?: OnboardingSourceIntent | null;
  telegramBotUsername?: string | null;
  onWebsite: (url: string, subject: WebsiteSubject, permissionConfirmed: boolean) => Promise<void>;
  onDocument: (file: File) => Promise<void>;
  onEmail: () => Promise<void>;
  onSlack?: () => Promise<void>;
  onTelegram?: () => Promise<void>;
  onSkip: () => Promise<void>;
}) {
  const tabs = orderChooserSources({ connectors, preferred: preferredSource });
  const [source, setSource] = useState<ChooserSourceId>(tabs[0] ?? 'document');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const selectionSeq = useRef(0);

  function run(task: () => Promise<void>) {
    const seq = selectionSeq.current + 1;
    selectionSeq.current = seq;
    setError(null);
    startTransition(async () => {
      try {
        await task();
      } catch (err: unknown) {
        if (seq !== selectionSeq.current) return;
        setError(err instanceof Error ? err.message : 'Could not continue.');
      }
    });
  }

  return (
    <div>
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Start with one source</h1>
      <p className="mt-2 text-sm leading-6 text-fg-muted">
        A Slack channel, Telegram group, brief, conversation, or company website. Bring in the
        context; review the people, projects and tasks it suggests.
      </p>
      <div className="mt-8 flex flex-wrap border-b border-border" aria-label="Choose a source">
        {tabs.map((id) => {
          const item = SOURCE_META[id];
          return (
            <button
              key={id}
              type="button"
              aria-pressed={source === id}
              disabled={pending}
              onClick={() => {
                setSource(id);
                setError(null);
              }}
              className={cn(
                'flex min-w-[5.5rem] flex-1 items-center justify-center gap-2 border-b-2 px-3 py-4 text-sm transition-colors',
                source === id
                  ? 'border-signal text-fg'
                  : 'border-transparent text-fg-muted hover:text-fg',
              )}
            >
              <item.icon aria-hidden="true" className="size-4" />
              {item.label}
            </button>
          );
        })}
      </div>
      <div className="py-8">
        {tabs.includes('slack') ? (
          <SlackChooserPanel
            hidden={source !== 'slack'}
            pending={pending}
            onSlack={
              onSlack
                ? () => {
                    run(onSlack);
                  }
                : undefined
            }
          />
        ) : null}
        {tabs.includes('telegram') ? (
          <TelegramChooserPanel
            hidden={source !== 'telegram'}
            pending={pending}
            telegramBotUsername={telegramBotUsername}
            onTelegram={
              onTelegram
                ? () => {
                    run(onTelegram);
                  }
                : undefined
            }
          />
        ) : null}
        <WebsiteChooserPanel
          hidden={source !== 'website'}
          pending={pending}
          onWebsite={(url, subject, confirmed) => {
            run(() => onWebsite(url, subject, confirmed));
          }}
        />
        <DocumentChooserPanel
          hidden={source !== 'document'}
          pending={pending}
          onDocument={(file) => {
            run(() => onDocument(file));
          }}
          onError={setError}
        />
        <EmailChooserPanel
          hidden={source !== 'email'}
          pending={pending}
          inboundEmail={inboundEmail}
          onEmail={() => {
            run(onEmail);
          }}
        />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-4 border-t border-border pt-5">
        <p className="max-w-sm text-xs leading-5 text-fg-muted">
          Sources stay attached. You review suggestions before they become lasting records.
        </p>
        <Button
          type="button"
          variant="ghost"
          disabled={pending}
          onClick={() => {
            run(onSkip);
          }}
        >
          Skip to Home <ArrowRight aria-hidden="true" className="ml-2 size-4" />
        </Button>
      </div>
      {error ? (
        <p role="alert" className="mt-4 text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
