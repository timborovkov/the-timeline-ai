'use client';

import { useEffect, useState, type ReactNode } from 'react';

import { CollectionRow } from '@/components/collections/collection-row';
import { CollectionStatus } from '@/components/collections/collection-status';
import { outputStatusLabel } from '@/components/reconciliation/presentation';
import { reconciliationOutputTone } from '@/components/reconciliation/row-status';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { ItemActionGroup, ItemOverflowMenu } from '@/components/ui/item-actions';

export function ClusterOutputRow({
  context,
  createdAtIso,
  payloadJson,
  relativeAge,
  status,
  title,
  titleHint,
}: {
  context: string;
  createdAtIso: string;
  payloadJson: string;
  relativeAge: string;
  status: string;
  title: string;
  titleHint: string;
}): ReactNode {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => {
      setCopied(false);
    }, 1500);
    return () => {
      window.clearTimeout(timer);
    };
  }, [copied]);

  async function copyPayload() {
    setCopyError(false);
    const clipboard = Reflect.get(navigator, 'clipboard') as Clipboard | undefined;
    if (!clipboard?.writeText) {
      setCopyError(true);
      return;
    }
    try {
      await clipboard.writeText(payloadJson);
    } catch {
      setCopyError(true);
      return;
    }
    setCopied(true);
  }

  return (
    <>
      <CollectionRow>
        <CollectionRow.Leading>
          <CollectionStatus
            value={status}
            label={outputStatusLabel(status)}
            tone={reconciliationOutputTone(status)}
          />
        </CollectionRow.Leading>
        <CollectionRow.Title title={titleHint}>{title}</CollectionRow.Title>
        <CollectionRow.Context title={titleHint}>{context}</CollectionRow.Context>
        <CollectionRow.Metadata>
          <time
            dateTime={createdAtIso}
            title={titleHint}
            className="text-xs tabular-nums text-fg-dim"
          >
            {relativeAge}
          </time>
        </CollectionRow.Metadata>
        <CollectionRow.Actions>
          <ItemActionGroup label={`Actions for ${title}`}>
            <ItemOverflowMenu targetLabel={title}>
              <DropdownMenuItem
                onSelect={() => {
                  void copyPayload();
                }}
              >
                {copied ? 'Copied payload' : 'Copy payload'}
              </DropdownMenuItem>
            </ItemOverflowMenu>
          </ItemActionGroup>
        </CollectionRow.Actions>
      </CollectionRow>
      <output
        aria-live="polite"
        aria-atomic="true"
        className={copyError ? 'px-3 pb-2 text-xs text-danger' : 'sr-only'}
      >
        {copyError
          ? 'Could not copy. Try again or select the text and copy it manually.'
          : copied
            ? 'Copied payload.'
            : ''}
      </output>
    </>
  );
}
