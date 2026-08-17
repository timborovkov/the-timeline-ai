'use client';

import { useMemo } from 'react';

import {
  framedHtmlDocument,
  hasSourceOriginal,
  sourceOriginalFromEvent,
  type SourceOriginal,
} from '@/lib/source-original';
import { cn } from '@/lib/utils';

export function SourceOriginalDisclosure({
  source,
  contentText,
  sourceMetadata,
  className,
}: {
  source: string;
  contentText?: string | null;
  sourceMetadata?: unknown;
  className?: string;
}) {
  const original = useMemo(
    () => sourceOriginalFromEvent({ source, contentText, sourceMetadata }),
    [source, contentText, sourceMetadata],
  );
  return <SourceOriginalDetails original={original} className={className} />;
}

export function SourceOriginalDetails({
  original,
  className,
}: {
  original: SourceOriginal;
  className?: string;
}) {
  if (!hasSourceOriginal(original)) return null;
  return (
    <details className={cn('group border-t border-border/80 pt-2 text-sm', className)}>
      <summary className="cursor-pointer list-none text-sm font-medium text-fg-muted marker:hidden hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
        <span aria-hidden="true" className="mr-2 inline-block text-fg-dim group-open:rotate-90">
          ›
        </span>
        {original.label}
      </summary>
      <div className="mt-2 space-y-3">
        <SourceOriginalBody original={original} />
      </div>
    </details>
  );
}

function SourceOriginalBody({ original }: { original: SourceOriginal }) {
  return (
    <>
      {original.html ? (
        <iframe
          title={original.label}
          sandbox=""
          referrerPolicy="no-referrer"
          srcDoc={framedHtmlDocument(original.html)}
          className="h-72 w-full rounded-sm border border-border bg-bg"
        />
      ) : null}
      {original.text ? (
        <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-sm border border-border bg-surface p-3 font-sans text-sm leading-6 text-fg">
          {original.text}
        </pre>
      ) : null}
      {original.json ? (
        original.html || original.text ? (
          <details>
            <summary className="cursor-pointer text-xs font-medium text-fg-dim hover:text-fg">
              Payload
            </summary>
            <JsonBlock value={original.json} className="mt-2" />
          </details>
        ) : (
          <JsonBlock value={original.json} />
        )
      ) : null}
    </>
  );
}

function JsonBlock({ value, className }: { value: unknown; className?: string }) {
  return (
    <pre
      className={cn(
        'max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-sm border border-border bg-surface p-3 font-mono text-xs leading-5 text-fg-muted',
        className,
      )}
    >
      {stringifyOriginalJson(value)}
    </pre>
  );
}

function stringifyOriginalJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return '[unserializable payload]';
  }
}
