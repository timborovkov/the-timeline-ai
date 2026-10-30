import { ArrowLeft, Bot, ExternalLink, KeyRound, ShieldCheck, TerminalSquare } from 'lucide-react';
import Link from 'next/link';

import { CopyButton } from '@/components/copy-button';
import { HelpAppLink } from '@/components/help/app-link';
import { Button } from '@/components/ui/button';
import {
  TIMELINE_AGENT_ACCESS_FAQS,
  TIMELINE_AGENT_INSTALL_STEPS,
  TIMELINE_AGENT_SKILL,
  TIMELINE_CLAUDE_PLUGIN_INSTALL_COMMAND,
  TIMELINE_CLAUDE_PLUGIN_INSTALL_URL,
  TIMELINE_CODEX_PLUGIN_INSTALL_URL,
  TIMELINE_MCP_COMMAND,
  TIMELINE_PLUGIN_INSTALL_PROMPT,
  TIMELINE_SKILL_INSTALL_PROMPT,
  TIMELINE_SKILLS_URL,
} from '@/lib/agent-install-content';

function CopyPanel({
  value,
  copyLabel,
  context,
}: {
  value: string;
  copyLabel: string;
  context: string;
}) {
  return (
    <div className="min-w-0 overflow-hidden rounded-sm border border-border bg-bg">
      <pre
        translate="no"
        className="overflow-x-auto whitespace-pre-wrap break-words p-4 font-mono text-xs leading-5 text-fg sm:p-5"
      >
        <code>{value}</code>
      </pre>
      <div className="flex min-h-12 flex-wrap items-center justify-between gap-2 border-t border-border bg-surface-2 px-2 pl-4">
        <span className="text-xs text-fg-muted">{context}</span>
        <CopyButton value={value} label={copyLabel} className="h-10 px-3" />
      </div>
    </div>
  );
}

export function AgentInstallGuide({ isSignedIn }: { isSignedIn: boolean }) {
  return (
    <>
      <header className="space-y-6">
        <Link
          href="/help"
          className="inline-flex min-h-10 items-center gap-2 rounded-sm text-sm font-medium text-fg-muted transition-colors hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fg focus-visible:ring-offset-2 focus-visible:ring-offset-bg forced-colors:focus-visible:outline forced-colors:focus-visible:outline-2"
        >
          <ArrowLeft aria-hidden="true" className="size-4" />
          All guides
        </Link>

        <div className="max-w-3xl space-y-5">
          <div className="inline-flex items-center gap-2 rounded-sm border border-border bg-surface-2 px-3 py-1.5 font-mono text-xs text-fg-muted">
            <Bot aria-hidden="true" className="size-4 text-signal" />
            Agents / Codex / Claude / ChatGPT / MCP
          </div>
          <h1 className="max-w-[15ch] text-4xl font-semibold tracking-[-0.035em] text-fg sm:text-5xl lg:text-6xl">
            Connect your agent to what actually happened.
          </h1>
          <p className="max-w-[62ch] text-lg leading-7 text-fg-muted sm:text-xl">
            Install one general Timeline skill that teaches your agent how to retrieve, verify, and
            cite workspace evidence visible to you as the authorizing member.
          </p>
        </div>
      </header>

      <section
        id="install"
        aria-labelledby="install-title"
        className="overflow-hidden rounded-sm border border-border bg-surface"
      >
        <div className="grid gap-6 border-b border-border p-5 sm:p-7 lg:grid-cols-[1fr_16rem]">
          <div className="space-y-4">
            <span className="inline-flex rounded-sm border border-signal/40 bg-signal/10 px-2 py-1 font-mono text-[0.6875rem] font-semibold uppercase tracking-[0.12em] text-fg">
              Recommended
            </span>
            <div className="space-y-2">
              <h2 id="install-title" className="text-2xl font-semibold tracking-tight text-fg">
                Install The Timeline plugin
              </h2>
              <p className="max-w-[58ch] text-sm leading-6 text-fg-muted">
                One bundle adds the Timeline skill and hosted MCP connection. Choose the install
                path for Codex or Claude Code.
              </p>
            </div>
          </div>
          <ul className="space-y-2 text-sm text-fg">
            {['General Timeline skill', 'Hosted MCP endpoint', 'Browser-based OAuth consent'].map(
              (item) => (
                <li key={item} className="flex gap-2">
                  <ShieldCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-signal" />
                  <span>{item}</span>
                </li>
              ),
            )}
          </ul>
        </div>
        <div className="space-y-4 p-5 sm:p-7">
          <div className="grid gap-4 xl:grid-cols-2 xl:items-start">
            <article className="space-y-4 rounded-sm border border-border p-4 sm:p-5">
              <div className="space-y-1">
                <h3 className="font-semibold text-fg">Codex</h3>
                <p className="text-sm leading-5 text-fg-muted">
                  Paste the prompt into a task. Codex adds the repository marketplace and installs
                  the plugin.
                </p>
              </div>
              <CopyPanel
                value={TIMELINE_PLUGIN_INSTALL_PROMPT}
                copyLabel="Copy Codex install prompt"
                context="Paste into a Codex task"
              />
              <Button asChild size="sm" variant="outline">
                <a href={TIMELINE_CODEX_PLUGIN_INSTALL_URL} target="_blank" rel="noreferrer">
                  Read the Codex install guide
                  <ExternalLink aria-hidden="true" />
                </a>
              </Button>
            </article>

            <article className="space-y-4 rounded-sm border border-border p-4 sm:p-5">
              <div className="space-y-1">
                <h3 className="font-semibold text-fg">Claude Code</h3>
                <p className="text-sm leading-5 text-fg-muted">
                  Run both commands in a terminal, then restart Claude Code and start a new
                  conversation.
                </p>
              </div>
              <CopyPanel
                value={TIMELINE_CLAUDE_PLUGIN_INSTALL_COMMAND}
                copyLabel="Copy Claude Code install commands"
                context="Run in a terminal"
              />
              <Button asChild size="sm" variant="outline">
                <a href={TIMELINE_CLAUDE_PLUGIN_INSTALL_URL} target="_blank" rel="noreferrer">
                  Read the Claude Code install guide
                  <ExternalLink aria-hidden="true" />
                </a>
              </Button>
            </article>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <HelpAppLink
              href="/app/me/connections"
              label="Manage approved AI apps"
              isSignedIn={isSignedIn}
            />
          </div>
        </div>
      </section>

      <section aria-labelledby="narrower-setup-title" className="space-y-6">
        <div className="max-w-2xl space-y-2">
          <h2 id="narrower-setup-title" className="text-2xl font-semibold tracking-tight text-fg">
            Prefer a narrower setup?
          </h2>
          <p className="text-sm leading-6 text-fg-muted">
            Install only the skill, or connect the MCP endpoint without the plugin.
          </p>
        </div>
        <div className="grid gap-4 xl:grid-cols-2 xl:items-start">
          <article className="space-y-4 rounded-sm border border-border p-5">
            <div className="flex items-start gap-3">
              <div className="grid size-9 shrink-0 place-items-center rounded-sm border border-border bg-surface-2">
                <Bot aria-hidden="true" className="size-4 text-signal" />
              </div>
              <div className="space-y-1">
                <h3 className="font-semibold text-fg">Skill only</h3>
                <p className="text-sm leading-5 text-fg-muted">
                  Best for self-hosted Timeline or agents that already have an MCP connection.
                </p>
              </div>
            </div>
            <CopyPanel
              value={TIMELINE_SKILL_INSTALL_PROMPT}
              copyLabel="Copy skill prompt"
              context="Paste into Codex"
            />
          </article>

          <article className="space-y-4 rounded-sm border border-border p-5">
            <div className="flex items-start gap-3">
              <div className="grid size-9 shrink-0 place-items-center rounded-sm border border-border bg-surface-2">
                <TerminalSquare aria-hidden="true" className="size-4 text-signal" />
              </div>
              <div className="space-y-1">
                <h3 className="font-semibold text-fg">MCP only</h3>
                <p className="text-sm leading-5 text-fg-muted">
                  Add the hosted URL directly. A compatible client discovers Timeline OAuth, opens
                  the browser consent flow, and keeps the resulting grant tied to your member
                  account.
                </p>
              </div>
            </div>
            <CopyPanel
              value={TIMELINE_MCP_COMMAND}
              copyLabel="Copy MCP command"
              context="Run in Codex CLI"
            />
          </article>
        </div>
      </section>

      <section aria-labelledby="setup-title" className="space-y-6 border-t border-border pt-10">
        <div className="max-w-2xl space-y-2">
          <p className="font-mono text-xs uppercase tracking-[0.12em] text-fg-muted">Three steps</p>
          <h2 id="setup-title" className="text-2xl font-semibold tracking-tight text-fg">
            From install to first answer
          </h2>
        </div>
        <ol className="grid gap-px overflow-hidden rounded-sm border border-border bg-border md:grid-cols-3">
          {TIMELINE_AGENT_INSTALL_STEPS.map((step, index) => (
            <li key={step.title} className="space-y-4 bg-bg p-5 sm:p-6">
              <span className="font-mono text-xs text-signal">0{index + 1}</span>
              <div className="space-y-2">
                <h3 className="font-semibold text-fg">{step.title}</h3>
                <p className="text-sm leading-6 text-fg-muted">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="skills-title" className="space-y-6 border-t border-border pt-10">
        <div className="max-w-2xl space-y-2">
          <h2 id="skills-title" className="text-2xl font-semibold tracking-tight text-fg">
            One skill, the whole workspace
          </h2>
          <p className="text-sm leading-6 text-fg-muted">
            The Timeline skill routes each request to the relevant MCP tools, expands material
            source records, and preserves citations, uncertainty, and visibility boundaries.
          </p>
        </div>
        <article className="flex max-w-3xl flex-col rounded-sm border border-border p-5">
          <Bot aria-hidden="true" className="mb-8 size-5 text-signal" />
          <h3 className="font-semibold text-fg">{TIMELINE_AGENT_SKILL.name}</h3>
          <code translate="no" className="mt-1 font-mono text-xs text-fg-muted">
            {TIMELINE_AGENT_SKILL.id}
          </code>
          <p className="mt-4 text-sm leading-6 text-fg-muted">{TIMELINE_AGENT_SKILL.description}</p>
          <a
            href={`${TIMELINE_SKILLS_URL}/${TIMELINE_AGENT_SKILL.id}`}
            target="_blank"
            rel="noreferrer"
            className="mt-5 inline-flex min-h-10 items-center gap-2 self-start rounded-sm text-sm font-medium text-fg transition-colors hover:text-signal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fg focus-visible:ring-offset-2 focus-visible:ring-offset-bg forced-colors:focus-visible:outline forced-colors:focus-visible:outline-2"
          >
            View skill
            <ExternalLink aria-hidden="true" className="size-3.5" />
          </a>
        </article>
      </section>

      <section
        aria-labelledby="access-title"
        className="grid gap-8 border-t border-border pt-10 lg:grid-cols-[15rem_1fr]"
      >
        <div className="space-y-3">
          <KeyRound aria-hidden="true" className="size-5 text-signal" />
          <h2 id="access-title" className="text-2xl font-semibold tracking-tight text-fg">
            Access, without surprises
          </h2>
          <p className="text-sm leading-6 text-fg-muted">
            The install path and access boundary are intentionally separate.
          </p>
        </div>
        <dl className="divide-y divide-border border-y border-border">
          {TIMELINE_AGENT_ACCESS_FAQS.map((item) => (
            <div key={item.question} className="grid gap-2 py-5 sm:grid-cols-[12rem_1fr] sm:gap-6">
              <dt className="text-sm font-semibold text-fg">{item.question}</dt>
              <dd className="text-sm leading-6 text-fg-muted">{item.answer}</dd>
            </div>
          ))}
        </dl>
      </section>
    </>
  );
}
