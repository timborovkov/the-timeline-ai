'use client';

import {
  ONBOARDING_DOCUMENT_MAX_BYTES,
  WEBSITE_SCAN_PAGE_CAP,
  type WebsiteSubject,
} from '@timeline/shared/onboarding/first-run';
import { FileUp, Globe, Mail, ArrowRight } from 'lucide-react';
import { useRef, useState, useTransition, type DragEvent } from 'react';

import { CopyableTextField } from '@/components/copyable-text-field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export function ChooserScreen({
  inboundEmail,
  onWebsite,
  onDocument,
  onEmail,
  onSkip,
}: {
  inboundEmail: string | null;
  onWebsite: (url: string, subject: WebsiteSubject, permissionConfirmed: boolean) => Promise<void>;
  onDocument: (file: File) => Promise<void>;
  onEmail: () => Promise<void>;
  onSkip: () => Promise<void>;
}) {
  const [source, setSource] = useState<'document' | 'website' | 'email'>('document');
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [websiteSubject, setWebsiteSubject] = useState<WebsiteSubject>('own_team');
  const [permissionConfirmed, setPermissionConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [pending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
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

  function handleFile(file: File | undefined) {
    if (pending || !file) return;
    if (file.size > ONBOARDING_DOCUMENT_MAX_BYTES) {
      setError('File exceeds 25 MB.');
      return;
    }
    run(() => onDocument(file));
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    if (pending) return;
    handleFile(event.dataTransfer.files[0]);
  }

  return (
    <div>
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Start with one source</h1>
      <p className="mt-2 text-sm leading-6 text-fg-muted">
        A brief, a conversation, a company website. Bring in the context; review the people,
        projects and tasks it suggests.
      </p>
      <div className="mt-8 flex border-b border-border" aria-label="Choose a source">
        {(
          [
            { id: 'document', label: 'Document', icon: FileUp },
            { id: 'email', label: 'Email', icon: Mail },
            { id: 'website', label: 'Website', icon: Globe },
          ] as const
        ).map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={source === item.id}
            disabled={pending}
            onClick={() => {
              setSource(item.id);
              setError(null);
            }}
            className={cn(
              'flex flex-1 items-center justify-center gap-2 border-b-2 px-3 py-4 text-sm transition-colors',
              source === item.id
                ? 'border-signal text-fg'
                : 'border-transparent text-fg-muted hover:text-fg',
            )}
          >
            <item.icon aria-hidden="true" className="size-4" />
            {item.label}
          </button>
        ))}
      </div>
      <div className="py-8">
        <article
          hidden={source !== 'website'}
          className="onboarding-source-panel min-w-0 space-y-5"
        >
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold">Scan your website</h2>
            </div>
            <p className="mt-1 text-[13px] leading-5 text-fg-muted">
              We read up to {WEBSITE_SCAN_PAGE_CAP} public pages, like home, about, pricing and
              product.
            </p>
          </div>
          <fieldset disabled={pending} className="space-y-2 text-[13px]">
            <legend className="mb-2 font-medium">Who is this website about?</legend>
            {(
              [
                ['own_team', 'Our team or company'],
                ['other_company', 'A client, partner or another company'],
              ] as const
            ).map(([value, label]) => (
              <label key={value} className="flex items-start gap-2">
                <input
                  type="radio"
                  name="website-subject"
                  value={value}
                  checked={websiteSubject === value}
                  onChange={() => {
                    setWebsiteSubject(value);
                  }}
                />
                {label}
              </label>
            ))}
          </fieldset>
          <p className="text-xs text-fg-muted">
            {websiteSubject === 'own_team'
              ? 'Suggest a company profile, people and projects supported by the pages.'
              : 'Suggest a Company record supported by the pages.'}{' '}
            You approve every record.
          </p>
          <label className="flex items-start gap-2 text-xs text-fg-muted">
            <input
              type="checkbox"
              checked={permissionConfirmed}
              disabled={pending}
              onChange={(event) => {
                setPermissionConfirmed(event.target.checked);
              }}
            />
            I confirm I may submit this website. Only public pages will be read.
          </label>
          <div className="mt-auto flex flex-wrap gap-2">
            <Input
              value={websiteUrl}
              onChange={(event) => {
                setWebsiteUrl(event.target.value);
              }}
              placeholder="company.example"
              disabled={pending}
              aria-label="Website address"
              className="min-w-0 flex-1"
            />
            <Button
              type="button"
              variant="outline"
              disabled={pending || !permissionConfirmed}
              onClick={() => {
                run(() => onWebsite(websiteUrl, websiteSubject, permissionConfirmed));
              }}
            >
              Scan
            </Button>
          </div>
        </article>

        <article
          hidden={source !== 'document'}
          className={cn(
            'onboarding-source-panel min-w-0 space-y-6 border bg-surface px-6 py-10 text-center',
            dragging ? 'border-fg' : 'border-border',
          )}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => {
            setDragging(false);
          }}
          onDrop={onDrop}
        >
          <div>
            <FileUp aria-hidden="true" className="mx-auto mb-4 size-8 text-signal" />
            <h2 className="text-xl font-semibold">Upload a document</h2>
            <p className="mt-1 text-[13px] leading-5 text-fg-muted">
              A pitch deck, proposal or brief. PDF or Office, up to 25 MB.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <input
              ref={fileRef}
              type="file"
              className="sr-only"
              accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.md,application/pdf"
              aria-label="Upload a document"
              disabled={pending}
              onChange={(event) => {
                handleFile(event.target.files?.[0]);
                event.currentTarget.value = '';
              }}
            />
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => fileRef.current?.click()}
            >
              Choose file
            </Button>
            <span className="text-xs text-fg-dim">or drop it here</span>
          </div>
        </article>

        <article hidden={source !== 'email'} className="onboarding-source-panel min-w-0 space-y-5">
          <div>
            <h2 className="text-sm font-semibold">Forward an email</h2>
            <p className="mt-1 text-[13px] leading-5 text-fg-muted">
              Forward, CC, or BCC one real thread to your team address.
            </p>
          </div>
          <div className="mt-auto">
            <CopyableTextField
              id="onboarding-forward-email"
              label="Team email"
              value={inboundEmail}
              emptyLabel="Team email isn’t configured yet"
              copyLabel="Copy team email"
            />
            <Button
              type="button"
              variant="outline"
              className="mt-2"
              disabled={pending}
              onClick={() => {
                run(onEmail);
              }}
            >
              I’m sending one
            </Button>
          </div>
        </article>
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
