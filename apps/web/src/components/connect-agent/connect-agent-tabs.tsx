'use client';

import { useId, useState, type KeyboardEvent } from 'react';

import { CopyButton } from '@/components/copy-button';
import { ProviderLogo } from '@/components/provider-logo';
import { Button } from '@/components/ui/button';
import { CONNECT_AGENT_GUIDES, type ConnectAgentId } from '@/lib/connect-agent-content';
import { cn } from '@/lib/utils';

function tabClass(active: boolean): string {
  return cn(
    'inline-flex shrink-0 cursor-pointer items-center gap-2 whitespace-nowrap rounded-t-sm px-2.5 py-2 text-sm no-underline transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-2 sm:px-3',
    active
      ? '-mb-px border-b-2 border-signal font-medium text-fg'
      : 'text-fg-muted hover:bg-surface-2 hover:text-fg',
  );
}

export function ConnectAgentTabs({ mcpUrl }: { mcpUrl: string }) {
  const labelId = useId();
  const [activeId, setActiveId] = useState<ConnectAgentId>('claude-code');
  const active =
    CONNECT_AGENT_GUIDES.find((guide) => guide.id === activeId) ?? CONNECT_AGENT_GUIDES[0];
  if (!active) return null;

  function activate(next: ConnectAgentId) {
    document.getElementById(`connect-agent-tab-${next}`)?.focus();
    setActiveId(next);
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, current: ConnectAgentId) {
    const ids = CONNECT_AGENT_GUIDES.map((guide) => guide.id);
    const index = ids.indexOf(current);
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      activate(ids[(index + 1) % ids.length] ?? current);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      activate(ids[(index - 1 + ids.length) % ids.length] ?? current);
    } else if (event.key === 'Home') {
      event.preventDefault();
      activate(ids[0] ?? current);
    } else if (event.key === 'End') {
      event.preventDefault();
      activate(ids[ids.length - 1] ?? current);
    }
  }

  return (
    <section className="space-y-4" aria-labelledby={labelId}>
      <div className="space-y-1">
        <h2 id={labelId} className="text-base font-semibold tracking-tight text-fg">
          Set up an agent
        </h2>
        <p className="text-sm leading-6 text-fg-muted">
          Prefer OAuth. Grant read for search, then capture for timeline.remember. Answers appear
          once work is captured; remember works now.
        </p>
      </div>
      <div className="border-b border-border">
        <div
          role="tablist"
          aria-label="Agent setup guides"
          className="flex min-w-0 gap-1 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {CONNECT_AGENT_GUIDES.map((guide) => {
            const selected = guide.id === active.id;
            return (
              <button
                key={guide.id}
                type="button"
                role="tab"
                id={`connect-agent-tab-${guide.id}`}
                aria-selected={selected}
                aria-controls={`connect-agent-panel-${guide.id}`}
                tabIndex={selected ? 0 : -1}
                className={tabClass(selected)}
                onClick={() => {
                  setActiveId(guide.id);
                }}
                onKeyDown={(event) => {
                  onKeyDown(event, guide.id);
                }}
              >
                <ProviderLogo src={guide.logo} size="sm" />
                {guide.label}
              </button>
            );
          })}
        </div>
      </div>
      {CONNECT_AGENT_GUIDES.map((guide) => {
        const selected = guide.id === active.id;
        return (
          <div
            key={guide.id}
            role="tabpanel"
            id={`connect-agent-panel-${guide.id}`}
            aria-labelledby={`connect-agent-tab-${guide.id}`}
            hidden={!selected}
            className="space-y-4"
          >
            {selected ? (
              <>
                <p className="text-sm leading-6 text-fg-muted">{guide.summary}</p>
                <ol className="space-y-2 border-y border-border py-3">
                  {guide.steps.map((step, index) => (
                    <li key={step} className="flex gap-3 text-sm leading-6 text-fg">
                      <span
                        aria-hidden="true"
                        className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border border-border font-mono text-[10px] text-fg-muted"
                      >
                        {index + 1}
                      </span>
                      <span>{step}</span>
                    </li>
                  ))}
                </ol>
                {guide.copy ? (
                  <pre
                    translate="no"
                    className="overflow-x-auto whitespace-pre-wrap break-words rounded-sm border border-border bg-surface-2 p-3 font-mono text-xs leading-5 text-fg"
                  >
                    <code>{guide.copy.value(mcpUrl)}</code>
                  </pre>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  {guide.copy ? (
                    <CopyButton value={guide.copy.value(mcpUrl)} label={guide.copy.label} />
                  ) : null}
                  {guide.deeplink ? (
                    <Button asChild size="sm">
                      <a href={guide.deeplink.href(mcpUrl)}>{guide.deeplink.label}</a>
                    </Button>
                  ) : null}
                </div>
              </>
            ) : null}
          </div>
        );
      })}
    </section>
  );
}
