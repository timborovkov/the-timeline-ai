'use client';

import {
  ONBOARDING_DOCUMENT_MAX_BYTES,
  WEBSITE_SCAN_PAGE_CAP,
} from '@timeline/shared/onboarding/first-run';
import { useRef, useState, useTransition, type DragEvent } from 'react';

import { CopyableTextField } from '@/components/copyable-text-field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export function ChooserScreen({
  inboundEmail,
  websiteScanEnabled,
  onWebsite,
  onDocument,
  onEmail,
  onSkip,
}: {
  inboundEmail: string | null;
  websiteScanEnabled: boolean;
  onWebsite: (url: string) => Promise<void>;
  onDocument: (file: File) => Promise<void>;
  onEmail: () => Promise<void>;
  onSkip: () => Promise<void>;
}) {
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [pending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  function run(task: () => Promise<void>) {
    setError(null);
    startTransition(() => {
      void task().catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Could not continue.');
      });
    });
  }

  function handleFile(file: File | undefined) {
    if (!file) return;
    if (file.size > ONBOARDING_DOCUMENT_MAX_BYTES) {
      setError('File exceeds 25 MB.');
      return;
    }
    run(() => onDocument(file));
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    handleFile(event.dataTransfer.files[0]);
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Bring something real</h1>
      <p className="mt-2 text-sm leading-6 text-fg-muted">
        Pick one thing your team already has. We turn it into a cited record you can ask about.
        Nothing becomes a lasting record until you approve it.
      </p>
      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <article className="flex min-w-0 flex-col gap-2.5 rounded-md border border-border bg-surface p-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold">Scan your website</h2>
              {websiteScanEnabled ? null : (
                <span className="rounded-sm border border-border px-1.5 py-0.5 text-[11px] text-fg-dim">
                  Coming soon
                </span>
              )}
            </div>
            <p className="mt-1 text-[13px] leading-5 text-fg-muted">
              We read up to {WEBSITE_SCAN_PAGE_CAP} public pages, like home, about, pricing and
              product.
            </p>
          </div>
          <div className="mt-auto flex flex-wrap gap-2">
            <Input
              value={websiteUrl}
              onChange={(event) => {
                setWebsiteUrl(event.target.value);
              }}
              placeholder="company.example"
              disabled={!websiteScanEnabled || pending}
              aria-label="Website address"
              className="min-w-0 flex-1"
            />
            <Button
              type="button"
              variant="outline"
              disabled={!websiteScanEnabled || pending}
              onClick={() => {
                run(() => onWebsite(websiteUrl));
              }}
            >
              Scan
            </Button>
          </div>
        </article>

        <article
          className={cn(
            'flex min-w-0 flex-col gap-2.5 rounded-md border bg-surface p-4',
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
            <h2 className="text-sm font-semibold">Upload a document</h2>
            <p className="mt-1 text-[13px] leading-5 text-fg-muted">
              A pitch deck, proposal or brief. PDF or Office, up to 25 MB.
            </p>
          </div>
          <div className="mt-auto flex flex-wrap items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              className="sr-only"
              accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.md,application/pdf"
              aria-label="Upload a document"
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

        <article className="flex min-w-0 flex-col gap-2.5 rounded-md border border-border bg-surface p-4">
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

        <article className="flex min-w-0 flex-col gap-2.5 rounded-md border border-border bg-surface p-4">
          <div>
            <h2 className="text-sm font-semibold">Skip for now</h2>
            <p className="mt-1 text-[13px] leading-5 text-fg-muted">
              Open an empty Home. You can upload a document, forward email, or connect a channel
              later.
            </p>
          </div>
          <div className="mt-auto">
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => {
                run(onSkip);
              }}
            >
              Skip to Home
            </Button>
          </div>
        </article>
      </div>
      {error ? (
        <p role="alert" className="mt-4 text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
