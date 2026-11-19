'use client';

import {
  ONBOARDING_DOCUMENT_MAX_BYTES,
  WEBSITE_SCAN_PAGE_CAP,
  type WebsiteSubject,
} from '@timeline/shared/onboarding/first-run';
import { FileUp } from 'lucide-react';
import { useRef, useState, type DragEvent } from 'react';

import { CopyableTextField } from '@/components/copyable-text-field';
import { GenerateGroupTokenForm } from '@/components/telegram-forms';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export function SlackChooserPanel({
  hidden,
  pending,
  onSlack,
}: {
  hidden: boolean;
  pending: boolean;
  onSlack?: () => void;
}) {
  return (
    <article hidden={hidden} className="onboarding-source-panel min-w-0 space-y-5">
      <div>
        <h2 className="text-sm font-semibold">Connect a Slack channel</h2>
        <p className="mt-1 text-[13px] leading-5 text-fg-muted">
          Install Timeline in Slack, bind one channel, and send a message. The work record opens
          when that evidence lands.
        </p>
      </div>
      <Button type="button" variant="outline" disabled={pending || !onSlack} onClick={onSlack}>
        Continue with Slack
      </Button>
    </article>
  );
}

export function TelegramChooserPanel({
  hidden,
  pending,
  telegramBotUsername,
  onTelegram,
}: {
  hidden: boolean;
  pending: boolean;
  telegramBotUsername: string | null;
  onTelegram?: () => void;
}) {
  return (
    <article hidden={hidden} className="onboarding-source-panel min-w-0 space-y-5">
      <div>
        <h2 className="text-sm font-semibold">Link a Telegram group</h2>
        <p className="mt-1 text-[13px] leading-5 text-fg-muted">
          Generate a group link token, add the bot, then send a message. The work record opens when
          that evidence lands.
        </p>
      </div>
      <GenerateGroupTokenForm botUsername={telegramBotUsername} />
      <Button
        type="button"
        variant="outline"
        disabled={pending || !onTelegram}
        onClick={onTelegram}
      >
        I’m linking a group
      </Button>
    </article>
  );
}

export function WebsiteChooserPanel({
  hidden,
  pending,
  onWebsite,
}: {
  hidden: boolean;
  pending: boolean;
  onWebsite: (url: string, subject: WebsiteSubject, permissionConfirmed: boolean) => void;
}) {
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [websiteSubject, setWebsiteSubject] = useState<WebsiteSubject>('own_team');
  const [permissionConfirmed, setPermissionConfirmed] = useState(false);

  return (
    <article hidden={hidden} className="onboarding-source-panel min-w-0 space-y-5">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold">Scan your website</h2>
        </div>
        <p className="mt-1 text-[13px] leading-5 text-fg-muted">
          We read up to {WEBSITE_SCAN_PAGE_CAP} public pages, like home, about, pricing and product.
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
            onWebsite(websiteUrl, websiteSubject, permissionConfirmed);
          }}
        >
          Scan
        </Button>
      </div>
    </article>
  );
}

export function DocumentChooserPanel({
  hidden,
  pending,
  onDocument,
  onError,
}: {
  hidden: boolean;
  pending: boolean;
  onDocument: (file: File) => void;
  onError: (message: string) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  function handleFile(file: File | undefined) {
    if (pending || !file) return;
    if (file.size > ONBOARDING_DOCUMENT_MAX_BYTES) {
      onError('File exceeds 25 MB.');
      return;
    }
    onDocument(file);
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    if (pending) return;
    handleFile(event.dataTransfer.files[0]);
  }

  return (
    <article
      hidden={hidden}
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
  );
}

export function EmailChooserPanel({
  hidden,
  pending,
  inboundEmail,
  onEmail,
}: {
  hidden: boolean;
  pending: boolean;
  inboundEmail: string | null;
  onEmail: () => void;
}) {
  return (
    <article hidden={hidden} className="onboarding-source-panel min-w-0 space-y-5">
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
          onClick={onEmail}
        >
          I’m sending one
        </Button>
      </div>
    </article>
  );
}
