'use client';

import { useId, useState, type KeyboardEvent } from 'react';

import { CollectionRow } from '@/components/collections/collection-row';
import { ConnectAgentPromptBar } from '@/components/connect-agent/connect-agent-prompt-bar';
import { CopyButton } from '@/components/copy-button';
import { ProviderLogo } from '@/components/provider-logo';
import { Button } from '@/components/ui/button';
import { CONNECT_AGENT_GUIDES, type ConnectAgentId } from '@/lib/connect-agent-content';

export function ConnectAgentTabs({
  mcpUrl,
  teamEmail,
}: {
  mcpUrl: string;
  teamEmail: string | null;
}) {
  const labelId = useId();
  const [activeId, setActiveId] = useState<ConnectAgentId>('claude-code');
  const active =
    CONNECT_AGENT_GUIDES.find((guide) => guide.id === activeId) ?? CONNECT_AGENT_GUIDES[0];
  if (!active) return null;

  function activate(next: ConnectAgentId) {
    setActiveId(next);
    document.querySelector<HTMLButtonElement>(`#connect-agent-client-${next} button`)?.focus();
  }

  function onListKeyDown(event: KeyboardEvent<HTMLUListElement>) {
    const ids = CONNECT_AGENT_GUIDES.map((guide) => guide.id);
    const index = ids.indexOf(activeId);
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
      event.preventDefault();
      activate(ids[(index + 1) % ids.length] ?? activeId);
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
      event.preventDefault();
      activate(ids[(index - 1 + ids.length) % ids.length] ?? activeId);
    } else if (event.key === 'Home') {
      event.preventDefault();
      activate(ids[0] ?? activeId);
    } else if (event.key === 'End') {
      event.preventDefault();
      activate(ids[ids.length - 1] ?? activeId);
    }
  }

  return (
    <section className="space-y-5" aria-labelledby={labelId}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 max-w-xl space-y-1">
          <h2 id={labelId} className="text-base font-semibold tracking-tight text-fg">
            Choose a client
          </h2>
          <p className="text-sm leading-6 text-fg-muted">
            Pick one, then sign in with OAuth. Copy a setup prompt if the client should install
            itself.
          </p>
        </div>
        <ConnectAgentPromptBar teamEmail={teamEmail} />
      </div>
      <ul className="border-t border-border" onKeyDown={onListKeyDown} aria-label="Agent clients">
        {CONNECT_AGENT_GUIDES.map((guide) => {
          const selected = guide.id === active.id;
          return (
            <li key={guide.id} id={`connect-agent-client-${guide.id}`}>
              <CollectionRow
                selected={selected}
                onActivate={() => {
                  setActiveId(guide.id);
                }}
                activateLabel={guide.label}
              >
                {guide.logo ? (
                  <CollectionRow.Leading>
                    <ProviderLogo src={guide.logo} size="sm" />
                  </CollectionRow.Leading>
                ) : null}
                <CollectionRow.Title>{guide.label}</CollectionRow.Title>
              </CollectionRow>
            </li>
          );
        })}
      </ul>
      <div
        role="region"
        id={`connect-agent-panel-${active.id}`}
        aria-labelledby={`connect-agent-client-${active.id}`}
        className="space-y-4"
      >
        <p className="text-sm leading-6 text-fg-muted">{active.summary}</p>
        <ol className="space-y-2">
          {active.steps.map((step, index) => (
            <li key={step} className="flex gap-3 text-sm leading-6 text-fg">
              <span aria-hidden="true" className="w-4 shrink-0 font-mono text-[11px] text-fg-dim">
                {index + 1}
              </span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
        {active.copy ? (
          <pre
            translate="no"
            className="overflow-x-auto whitespace-pre-wrap break-words rounded-sm border border-border bg-surface-2 p-3 font-mono text-xs leading-5 text-fg"
          >
            <code>{active.copy.value(mcpUrl)}</code>
          </pre>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {active.deeplink ? (
            <Button asChild size="sm">
              <a href={active.deeplink.href(mcpUrl)}>{active.deeplink.label}</a>
            </Button>
          ) : null}
          {active.copy ? (
            <CopyButton value={active.copy.value(mcpUrl)} label={active.copy.label} />
          ) : null}
        </div>
      </div>
    </section>
  );
}
