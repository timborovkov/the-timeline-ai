'use client';

import { ArrowRight, CircleAlert, CircleCheckBig, Clock, ListTodo, Send } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { CitationChip } from '@/components/mockups/citation-chip';
import {
  ASK_SUGGESTIONS,
  CURRENT_HOME_ATTENTION,
  CURRENT_HOME_MOMENTS,
  TODAY_COUNTS,
  TODAY_MEETINGS,
  TODAY_NEEDS,
  mockEvidence,
  mockPerson,
} from '@/components/mockups/mockup-data';
import { PersonChip, ProjectChip } from '@/components/mockups/person-chip';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function BriefHome() {
  const [prompt, setPrompt] = useState('');
  const [recordOpen, setRecordOpen] = useState(false);
  const [done, setDone] = useState<Record<string, string>>({});

  function mockAction(id: string, message: string) {
    setDone((current) => ({ ...current, [id]: message }));
    toast.success(message);
  }

  return (
    <div className="space-y-8">
      <h1 className="sr-only">Today</h1>

      <section aria-labelledby="today-brief-heading" className="max-w-[70ch]">
        <p className="text-xs font-medium text-fg-dim">Monday · Acme Labs · example data</p>
        <h2 id="today-brief-heading" className="mt-1 text-base font-semibold text-fg">
          Good morning, Avery
        </h2>
        <p className="mt-3 text-sm leading-[1.65] text-fg">
          <PersonChip personId="elena" /> at <ProjectChip projectId="northstar" /> has not answered
          Thursday’s field-mapping note, so the CSV fallback is still waiting on three columns
          <CitationChip evidenceId="elenaEmail" />. <PersonChip personId="casey" /> told{' '}
          <PersonChip personId="priya" /> the diligence pack would land Friday; that promise is now
          overdue
          <CitationChip evidenceId="caseySlack" />. <PersonChip personId="maya" /> has a final-round
          at <span className="font-mono text-[13px] tabular-nums">15:00</span> —{' '}
          <PersonChip personId="sam" /> left the scorecard in #hiring
          <CitationChip evidenceId="mayaCal" />.
        </p>
      </section>

      <section aria-label="Today counts">
        <div className="flex flex-wrap gap-x-6 gap-y-2 border-y border-border py-3">
          {TODAY_COUNTS.map((item) => (
            <a
              key={item.id}
              href={`#${item.id === 'needs' ? 'needs-you' : item.id === 'meetings' ? 'coming-up' : 'needs-you'}`}
              className="flex items-baseline gap-2 rounded-sm text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span
                className={cn(
                  'font-mono tabular-nums',
                  item.danger ? 'text-danger' : 'text-signal',
                )}
              >
                {item.count}
              </span>
              <span className="text-fg-muted">{item.label}</span>
            </a>
          ))}
        </div>
      </section>

      <section id="needs-you" aria-labelledby="needs-you-heading" className="space-y-3">
        <h2 id="needs-you-heading" className="text-base font-semibold text-fg">
          Needs you
        </h2>
        <ul className="divide-y divide-border border-y border-border">
          {TODAY_NEEDS.map((item) => {
            const completed = done[item.id];
            return (
              <li
                key={item.id}
                className="flex flex-col gap-3 py-4 sm:flex-row sm:items-start sm:gap-4"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium text-fg">{item.title}</p>
                    {'personId' in item ? <PersonChip personId={item.personId} /> : null}
                    {'projectId' in item ? <ProjectChip projectId={item.projectId} /> : null}
                  </div>
                  <p className="mt-1 text-sm leading-[1.55] text-fg-muted">{item.body}</p>
                  <p
                    className={cn(
                      'mt-1 font-mono text-[11px] tabular-nums',
                      'danger' in item ? 'text-danger' : 'text-fg-dim',
                    )}
                  >
                    {item.context}
                    <CitationChip evidenceId={item.evidenceId} />
                  </p>
                  {completed ? <p className="mt-2 text-xs text-fg-muted">{completed}</p> : null}
                </div>
                <div className="shrink-0">
                  <Button
                    size="sm"
                    variant={item.id === 'elena-reply' ? 'default' : 'outline'}
                    disabled={Boolean(completed)}
                    onClick={() => {
                      mockAction(item.id, mockActionCopy(item.id));
                    }}
                  >
                    {item.primary}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <section id="coming-up" aria-labelledby="coming-up-heading" className="space-y-3">
        <h2 id="coming-up-heading" className="text-base font-semibold text-fg">
          Coming up
        </h2>
        <ul className="divide-y divide-border border-y border-border">
          {TODAY_MEETINGS.map((meeting) => {
            const completed = done[meeting.id];
            return (
              <li key={meeting.id} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-fg">{meeting.title}</p>
                  <p className="font-mono text-[11px] tabular-nums text-fg-dim">
                    {meeting.when}
                    <CitationChip evidenceId={meeting.evidenceId} />
                  </p>
                  <p className="mt-1 text-xs text-fg-muted">{meeting.detail}</p>
                  {completed ? <p className="mt-1 text-xs text-fg-muted">{completed}</p> : null}
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={Boolean(completed)}
                  onClick={() => {
                    mockAction(
                      meeting.id,
                      `Prep pack ready · example data · ${mockPerson(meeting.personId).name}`,
                    );
                  }}
                >
                  Prep me
                </Button>
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby="home-ask-title" className="space-y-3">
        <div>
          <h2 id="home-ask-title" className="text-base font-semibold text-fg">
            Ask the timeline
          </h2>
          <p className="mt-1 text-sm text-fg-muted">
            Suggestion chips stay in this mockup. They do not open the live Ask route.
          </p>
        </div>
        <div className="relative rounded-sm border border-border bg-surface focus-within:border-border-strong focus-within:ring-2 focus-within:ring-signal/40 focus-within:ring-offset-2 focus-within:ring-offset-bg">
          <label htmlFor="mockup-home-ask" className="sr-only">
            Question for Ask
          </label>
          <input
            id="mockup-home-ask"
            type="text"
            value={prompt}
            onChange={(event) => {
              setPrompt(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                toast.message('Mockup only — this would open Ask with that question.');
              }
            }}
            className="h-10 w-full truncate rounded-sm bg-transparent pl-3 pr-12 text-base focus:outline-none sm:text-sm"
            placeholder="Ask the timeline…"
          />
          <button
            type="button"
            aria-label="Send"
            onClick={() => {
              toast.message('Mockup only — this would open Ask with that question.');
            }}
            className="absolute right-1 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-sm bg-signal text-signal-fg transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong focus-visible:ring-offset-2"
          >
            <Send aria-hidden="true" className="size-4" />
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          {ASK_SUGGESTIONS.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              className="rounded-sm border border-border bg-surface px-3 py-1.5 text-left text-sm text-fg-muted transition-colors hover:border-border-strong hover:bg-surface-2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => {
                setPrompt(suggestion);
                toast.message(`Mockup only — would ask: ${suggestion}`);
              }}
            >
              {suggestion}
            </button>
          ))}
        </div>
      </section>

      <section aria-labelledby="today-record-heading">
        <button
          type="button"
          aria-expanded={recordOpen}
          onClick={() => {
            setRecordOpen((open) => !open);
          }}
          className="flex w-full items-center justify-between gap-3 rounded-sm py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <div>
            <h2 id="today-record-heading" className="text-base font-semibold text-fg">
              Today’s record
            </h2>
            <p className="mt-1 text-sm text-fg-muted">
              Current Home still exists — attention counts and recent moments, one click deeper.
            </p>
          </div>
          <ArrowRight
            aria-hidden="true"
            className={cn(
              'size-4 shrink-0 text-fg-dim transition-transform duration-150 motion-reduce:transition-none',
              recordOpen && 'rotate-90',
            )}
          />
        </button>
        {recordOpen ? <CurrentHomeContrast /> : null}
      </section>
    </div>
  );
}

function CurrentHomeContrast() {
  return (
    <div className="mt-4 space-y-6">
      <div className="divide-y divide-border border-y border-border">
        {CURRENT_HOME_ATTENTION.map((group) => (
          <div key={group.href} className="flex items-center gap-3 py-3 sm:px-3">
            <span className={group.danger ? 'text-danger' : 'text-signal'}>
              {group.danger ? (
                <CircleAlert aria-hidden="true" className="size-4" />
              ) : group.label.includes('approval') ? (
                <CircleCheckBig aria-hidden="true" className="size-4" />
              ) : group.label.includes('task') ? (
                <ListTodo aria-hidden="true" className="size-4" />
              ) : (
                <Clock aria-hidden="true" className="size-4" />
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-fg">
                <span className="font-mono">{group.count}</span> {group.label}
              </span>
            </span>
            <span className="text-xs text-fg-muted">{group.action}</span>
            <ArrowRight aria-hidden="true" className="size-4 text-fg-dim" />
          </div>
        ))}
      </div>
      <ul className="border-t border-border">
        {CURRENT_HOME_MOMENTS.map((moment) => (
          <li
            key={moment.id}
            className="-mx-3 flex min-h-9 items-center gap-3 border-b border-border px-3 py-1.5"
          >
            <span className="w-[4.75rem] shrink-0 font-mono text-[11px] tabular-nums text-fg-dim">
              {moment.time}
            </span>
            <span className="max-w-[8rem] shrink-0 truncate text-[11px] text-fg-muted">
              {moment.source}
            </span>
            <span className="min-w-0 flex-1 truncate text-sm text-fg underline decoration-fg-dim underline-offset-2">
              {moment.title}
            </span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-fg-dim">
        Example data. {mockEvidence('elenaEmail').sourceLabel} and Slack rows are illustrative, not
        live events.
      </p>
    </div>
  );
}

function mockActionCopy(id: string): string {
  if (id === 'elena-reply') return 'Reply draft ready · example data · would open in Ask';
  if (id === 'priya-pack') return 'Prep pack ready · example data · promised Friday, still open';
  return 'Queued in Approvals · example data · Polar Studio stays pending until you accept';
}
