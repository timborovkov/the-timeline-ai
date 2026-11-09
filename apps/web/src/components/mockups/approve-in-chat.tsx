'use client';

import { Check, Pencil, Send, SkipForward } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { CitationChip } from '@/components/mockups/citation-chip';
import {
  ASK_USER_PROMPT,
  DRAFT_REPLY,
  PEOPLE,
  SLACK_THREAD,
  TELEGRAM_THREAD,
  mockPerson,
  type PersonId,
} from '@/components/mockups/mockup-data';
import { PersonAvatar, PersonChip, ProjectChip } from '@/components/mockups/person-chip';
import { ProviderLogo } from '@/components/provider-logo';
import { Button } from '@/components/ui/button';
import { providerLogoSrc } from '@/lib/connections';
import { cn } from '@/lib/utils';

type Surface = 'slack' | 'telegram';
type CardKind = 'reply' | 'record';
type CardState = 'pending' | 'editing' | 'sent' | 'queued' | 'skipped';

interface ProposalModel {
  draft: string;
  state: CardState;
}

interface SharedProposals {
  record: ProposalModel;
  reply: ProposalModel;
  onRecordChange: (next: ProposalModel) => void;
  onReplyChange: (next: ProposalModel) => void;
}

export function ApproveInChat() {
  const [surface, setSurface] = useState<Surface>('slack');
  const [mobilePane, setMobilePane] = useState<'external' | 'app'>('external');
  const [reply, setReply] = useState<ProposalModel>({ draft: DRAFT_REPLY, state: 'pending' });
  const [record, setRecord] = useState<ProposalModel>({
    draft: 'Northstar Works · stage Pilot → Validation',
    state: 'pending',
  });
  const proposals: SharedProposals = {
    record,
    reply,
    onRecordChange: setRecord,
    onReplyChange: setReply,
  };

  return (
    <div data-app-layout="full-bleed" className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 md:px-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-fg">Approve in chat</h1>
          <p className="mt-1 text-sm text-fg-muted">
            Outbound replies can send from here. Lasting record changes still wait in Approvals.
          </p>
        </div>
        <div className="flex rounded-sm border border-border bg-surface p-0.5 md:hidden">
          <PaneTab
            selected={mobilePane === 'external'}
            onSelect={() => {
              setMobilePane('external');
            }}
          >
            {surface === 'slack' ? 'Slack' : 'Telegram'}
          </PaneTab>
          <PaneTab
            selected={mobilePane === 'app'}
            onSelect={() => {
              setMobilePane('app');
            }}
          >
            In-app Ask
          </PaneTab>
        </div>
      </div>
      <div className="grid min-h-0 flex-1 md:grid-cols-2">
        <section
          aria-labelledby="external-thread-heading"
          className={cn(
            'min-h-0 overflow-y-auto border-b border-border md:border-b-0 md:border-r',
            mobilePane === 'app' && 'hidden md:block',
          )}
        >
          <ExternalThread proposals={proposals} surface={surface} onSurfaceChange={setSurface} />
        </section>
        <section
          aria-labelledby="in-app-heading"
          className={cn('min-h-0 overflow-y-auto', mobilePane === 'external' && 'hidden md:block')}
        >
          <InAppAsk proposals={proposals} />
        </section>
      </div>
    </div>
  );
}

function PaneTab({
  children,
  onSelect,
  selected,
}: {
  children: string;
  onSelect: () => void;
  selected: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'rounded-sm px-3 py-1.5 text-sm font-medium',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        selected ? 'bg-signal-soft text-fg' : 'text-fg-muted',
      )}
    >
      {children}
    </button>
  );
}

function ExternalThread({
  proposals,
  surface,
  onSurfaceChange,
}: {
  proposals: SharedProposals;
  surface: Surface;
  onSurfaceChange: (surface: Surface) => void;
}) {
  const isSlack = surface === 'slack';
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <ProviderLogo
            src={providerLogoSrc(surface)}
            size="xs"
            title={isSlack ? 'Slack' : 'Telegram'}
          />
          <div className="min-w-0">
            <h2 id="external-thread-heading" className="truncate text-sm font-semibold text-fg">
              {isSlack ? '#gtm' : 'Acme leadership'}
            </h2>
            <p className="font-mono text-[11px] text-fg-dim">
              {isSlack ? 'Slack · example data' : 'Telegram · example data'}
            </p>
          </div>
        </div>
        <div className="flex rounded-sm border border-border p-0.5">
          <PaneTab
            selected={isSlack}
            onSelect={() => {
              onSurfaceChange('slack');
            }}
          >
            Slack
          </PaneTab>
          <PaneTab
            selected={!isSlack}
            onSelect={() => {
              onSurfaceChange('telegram');
            }}
          >
            Telegram
          </PaneTab>
        </div>
      </div>
      <div className="flex-1 space-y-4 px-4 py-4">
        {(isSlack ? SLACK_THREAD : TELEGRAM_THREAD).map((message) => (
          <article key={message.id} className="flex gap-2.5">
            <PersonAvatar person={personFromName(message.author)} size="md" />
            <div className="min-w-0">
              <p className="text-sm">
                <span className="font-medium text-fg">{message.author}</span>
                <span className="ml-2 font-mono text-[11px] text-fg-dim">{message.time}</span>
              </p>
              <p className="mt-0.5 text-sm leading-[1.55] text-fg">{message.text}</p>
            </div>
          </article>
        ))}
        <article className="flex gap-2.5">
          <span className="grid size-8 shrink-0 place-items-center rounded-sm border border-border bg-surface text-[10px] font-semibold text-signal">
            TL
          </span>
          <div className="min-w-0 flex-1 space-y-3">
            <p className="text-sm">
              <span className="font-medium text-fg">The Timeline</span>
              <span className="ml-2 font-mono text-[11px] text-fg-dim">09:05</span>
            </p>
            <p className="text-sm leading-[1.55] text-fg">
              I drafted a reply to <PersonChip personId="elena" /> and a record change on{' '}
              <ProjectChip projectId="northstar" />. The reply can send from here. The stage change
              still waits for approval.
            </p>
            <ProposalCards
              proposals={proposals}
              surfaceLabel={isSlack ? 'Approve & send to Slack' : 'Approve & send to Telegram'}
            />
          </div>
        </article>
      </div>
    </div>
  );
}

function InAppAsk({ proposals }: { proposals: SharedProposals }) {
  const [prompt, setPrompt] = useState('');
  return (
    <div className="flex h-full flex-col px-4 py-5 md:px-6">
      <header className="mb-5 flex min-w-0 shrink-0 items-baseline gap-x-3 border-b border-border pb-3">
        <h2 id="in-app-heading" className="shrink-0 text-2xl font-semibold tracking-tight text-fg">
          Ask
        </h2>
        <p className="min-w-0 truncate text-sm text-fg-muted">Elena Park follow-up</p>
      </header>
      <ol className="flex flex-1 flex-col gap-6 overflow-y-auto pb-4">
        <li className="flex flex-col items-end gap-1.5">
          <span className="px-1 text-xs text-fg-dim">You</span>
          <div className="max-w-[90%] rounded-sm bg-surface-2 px-4 py-2.5 text-sm leading-relaxed text-fg">
            {ASK_USER_PROMPT}
          </div>
        </li>
        <li className="flex flex-col items-start gap-1.5">
          <span className="px-1 text-xs text-fg-dim">Agent</span>
          <div className="max-w-[90%] border-l-2 border-signal bg-transparent py-1 pl-4 pr-1 text-sm leading-relaxed text-fg">
            <p>
              Two actions, with different stakes. The outbound note to{' '}
              <PersonChip personId="elena" /> can send after you approve it
              <CitationChip evidenceId="elenaEmail" />. Updating{' '}
              <ProjectChip projectId="northstar" /> from Pilot to Validation is a lasting record
              change, so it waits in Approvals
              <CitationChip evidenceId="csvFallback" />.
            </p>
            <div className="mt-3 space-y-3">
              <ProposalCards proposals={proposals} surfaceLabel="Approve & send" />
            </div>
          </div>
        </li>
      </ol>
      <div className="relative shrink-0 rounded-sm border border-border bg-surface focus-within:border-border-strong focus-within:ring-2 focus-within:ring-signal/40 focus-within:ring-offset-2 focus-within:ring-offset-bg">
        <label htmlFor="mockup-ask-composer" className="sr-only">
          Ask the timeline
        </label>
        <input
          id="mockup-ask-composer"
          type="text"
          value={prompt}
          onChange={(event) => {
            setPrompt(event.target.value);
          }}
          placeholder="Ask the timeline…"
          className="h-10 w-full truncate rounded-sm bg-transparent pl-3 pr-12 text-base focus:outline-none sm:text-sm"
        />
        <button
          type="button"
          aria-label="Send"
          className="absolute right-1 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-sm bg-signal text-signal-fg hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong"
          onClick={() => {
            toast.message('Mockup only — the composer does not call Ask.');
          }}
        >
          <Send aria-hidden="true" className="size-4" />
        </button>
      </div>
    </div>
  );
}

function ProposalCards({
  proposals,
  surfaceLabel,
}: {
  proposals: SharedProposals;
  surfaceLabel: string;
}) {
  return (
    <div className="space-y-3">
      <ProposalCard
        kind="reply"
        model={proposals.reply}
        title="Drafted reply"
        approveLabel={surfaceLabel}
        approveToast="Sent · example data · this would post the reply"
        onChange={proposals.onReplyChange}
      />
      <ProposalCard
        kind="record"
        model={proposals.record}
        title="Proposed record change"
        detail="Lasting work state. Accepting queues it in Approvals; it does not write the record from chat."
        approveLabel="Approve record change"
        approveToast="Queued in Approvals · example data · Northstar Works stage stays pending"
        secondary
        onChange={proposals.onRecordChange}
      />
    </div>
  );
}

function ProposalCard({
  approveLabel,
  approveToast,
  detail,
  kind,
  model,
  secondary = false,
  title,
  onChange,
}: {
  approveLabel: string;
  approveToast: string;
  detail?: string;
  kind: CardKind;
  model: ProposalModel;
  secondary?: boolean;
  title: string;
  onChange: (next: ProposalModel) => void;
}) {
  if (model.state === 'skipped') {
    return (
      <div className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg-muted">
        Skipped · {title.toLowerCase()} · example data
      </div>
    );
  }

  if (model.state === 'sent' || model.state === 'queued') {
    return (
      <div className="rounded-md border border-border bg-surface px-3 py-3">
        <p className="flex items-center gap-2 text-xs font-medium text-fg">
          <Check aria-hidden="true" className="size-3.5 text-signal" />
          {model.state === 'sent' ? 'Sent' : 'Queued for approval'}
        </p>
        <p className="mt-1 text-sm text-fg-muted">{approveToast}</p>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'rounded-md border p-3',
        secondary ? 'border-border bg-surface' : 'border-signal/40 bg-signal-soft',
      )}
    >
      <p className="text-xs font-medium text-fg">
        {kind === 'reply' ? 'Approval needed' : 'Approval queued'}
      </p>
      <p className="mt-1 text-sm font-medium text-fg">{title}</p>
      {model.state === 'editing' ? (
        <label className="mt-2 block">
          <span className="sr-only">Edit {title}</span>
          <textarea
            value={model.draft}
            onChange={(event) => {
              onChange({ ...model, draft: event.target.value });
            }}
            rows={4}
            className="w-full rounded-sm border border-border bg-bg px-2 py-2 text-sm leading-[1.55] text-fg focus:border-border-strong focus:outline-none focus:ring-2 focus:ring-signal/40"
          />
        </label>
      ) : (
        <p className="mt-1 text-sm leading-[1.55] text-fg">{model.draft}</p>
      )}
      {detail ? <p className="mt-2 text-xs text-fg-muted">{detail}</p> : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          size="sm"
          variant={secondary ? 'outline' : 'default'}
          onClick={() => {
            onChange({ ...model, state: kind === 'reply' ? 'sent' : 'queued' });
            toast.success(approveToast);
          }}
        >
          {approveLabel}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            onChange({ ...model, state: model.state === 'editing' ? 'pending' : 'editing' });
          }}
        >
          <Pencil aria-hidden="true" className="size-3.5" />
          {model.state === 'editing' ? 'Done editing' : 'Edit'}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            onChange({ ...model, state: 'skipped' });
            toast.message(`Skipped · ${title.toLowerCase()} · example data`);
          }}
        >
          <SkipForward aria-hidden="true" className="size-3.5" />
          Skip
        </Button>
      </div>
    </div>
  );
}

function personFromName(name: string) {
  const id = (Object.keys(PEOPLE) as PersonId[]).find((personId) => PEOPLE[personId].name === name);
  return mockPerson(id ?? 'avery');
}
