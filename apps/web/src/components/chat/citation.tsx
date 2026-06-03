'use client';

// Sub-path import (see @timeline/shared exports map) so the client bundle
// doesn't pull the queue/qdrant/llm modules that the package index
// re-exports — those drag in bullmq → ioredis → node:dns and fail the
// Next.js client compile.
import { parseCitations } from '@timeline/shared/citation';
import { Fragment, type ReactNode } from 'react';

import { CitationChip } from '@/components/citation-chip';

interface Props {
  text: string;
}

/**
 * Splits the assistant's text into runs and citation chips. Each chip is
 * a {@link CitationChip} in `href` mode:
 *  - `[ev:<id>]` → `/app/timeline#ev-<id>` (URL hash scrolls to the row)
 *  - `[ent:<id>]` → `/app/objects/<id>`
 *  - `[doc:<id>#v<n>:chunk:<id>]` →
 *    `/app/documents/<id>?version=<n>#chunk-<id>`
 *
 * The visual matches the system-wide citation primitive — mono lime
 * brackets on a signal-soft background — so chips inside chat read the
 * same as chips anywhere else.
 *
 * Text also renders the lightweight Markdown shape LLMs normally produce
 * in AI SDK chat parts: paragraphs, bullets, numbered lists, headings,
 * and bold spans.
 *
 * Parsing lives in @timeline/shared so the regex is unit-tested without
 * a React/Next render.
 */
export function CitationText({ text }: Props) {
  const blocks = parseMarkdownBlocks(text);

  return (
    <div className="space-y-3 leading-relaxed">
      {blocks.map((block, index) => {
        const key = `${block.type}-${String(index)}`;
        switch (block.type) {
          case 'ul':
            return (
              <ul key={key} className="ml-5 list-disc space-y-1 marker:text-fg-dim">
                {block.items.map((item, itemIndex) => (
                  <li key={`${key}-${String(itemIndex)}`}>
                    {renderInline(item, `${key}-${String(itemIndex)}`)}
                  </li>
                ))}
              </ul>
            );
          case 'ol':
            return (
              <ol
                key={key}
                start={block.items[0]?.value}
                className="ml-5 list-decimal space-y-1 marker:text-fg-dim"
              >
                {block.items.map((item, itemIndex) => (
                  <li key={`${key}-${String(itemIndex)}`} value={item.value}>
                    {renderInline(item.text, `${key}-${String(itemIndex)}`)}
                  </li>
                ))}
              </ol>
            );
          case 'heading':
            return (
              <p key={key} className="font-semibold text-fg">
                {renderInline(block.text, key)}
              </p>
            );
          case 'paragraph':
            return <p key={key}>{renderInline(block.text, key)}</p>;
        }
      })}
    </div>
  );
}

type MarkdownBlock =
  | { type: 'paragraph'; text: string }
  | { type: 'heading'; text: string }
  | { type: 'ul'; items: string[] }
  | { type: 'ol'; items: { value: number; text: string }[] };

function parseMarkdownBlocks(text: string): MarkdownBlock[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const blocks: MarkdownBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? '';
    if (line.trim().length === 0) {
      index += 1;
      continue;
    }

    const heading = /^(#{1,4})\s+(.+)$/.exec(line);
    if (heading?.[2]) {
      blocks.push({ type: 'heading', text: heading[2].trim() });
      index += 1;
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^[-*]\s+/.test(lines[index] ?? '')) {
        items.push((lines[index] ?? '').replace(/^[-*]\s+/, '').trim());
        index += 1;
      }
      blocks.push({ type: 'ul', items });
      continue;
    }

    if (/^1[.)]\s+/.test(line)) {
      const items: { value: number; text: string }[] = [];
      while (index < lines.length && /^\d+[.)]\s+/.test(lines[index] ?? '')) {
        const item = /^(\d+)[.)]\s+(.+)$/.exec(lines[index] ?? '');
        if (item?.[1] && item[2]) {
          items.push({ value: Number(item[1]), text: item[2].trim() });
        }
        index += 1;
      }
      blocks.push({ type: 'ol', items });
      continue;
    }

    const paragraph: string[] = [];
    while (
      index < lines.length &&
      (lines[index] ?? '').trim().length > 0 &&
      !/^(#{1,4})\s+/.test(lines[index] ?? '') &&
      !/^[-*]\s+/.test(lines[index] ?? '') &&
      !/^1[.)]\s+/.test(lines[index] ?? '')
    ) {
      paragraph.push(lines[index] ?? '');
      index += 1;
    }
    blocks.push({ type: 'paragraph', text: paragraph.join('\n') });
  }

  return blocks;
}

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const parts = parseCitations(text);

  return parts.map((p, i) => {
    const key = `${keyPrefix}-${String(i)}`;
    if (p.type === 'text') return <Fragment key={key}>{renderStrongText(p.value, key)}</Fragment>;
    if (p.type === 'ev') {
      return (
        <span key={key} className="mx-0.5">
          <CitationChip
            id={`ev:${p.value.slice(0, 8)}`}
            source="Event"
            href={`/app/timeline#ev-${p.value}`}
          />
        </span>
      );
    }
    if (p.type === 'ent') {
      return (
        <span key={key} className="mx-0.5">
          <CitationChip
            id={`ent:${p.value.slice(0, 8)}`}
            source="Entity"
            href={`/app/objects/${p.value}`}
          />
        </span>
      );
    }
    // p.type === 'doc' — Phase 9: chunk-precise citation. Link
    // carries the version + chunk hash so the document detail
    // page can scroll to the exact cited slice.
    return (
      <span key={key} className="mx-0.5">
        <CitationChip
          id={`doc:${p.documentId.slice(0, 8)}#v${p.version}`}
          source="Document"
          href={`/app/documents/${p.documentId}?version=${p.version}#chunk-${p.chunkId}`}
        />
      </span>
    );
  });
}

function renderStrongText(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const strongRe = /\*\*([^*\n]+)\*\*/g;
  let lastIndex = 0;

  for (const match of text.matchAll(strongRe)) {
    const start = match.index;
    if (start > lastIndex) {
      nodes.push(text.slice(lastIndex, start));
    }
    nodes.push(
      <strong key={`${keyPrefix}-strong-${String(start)}`} className="font-semibold">
        {match[1]}
      </strong>,
    );
    lastIndex = start + match[0].length;
  }

  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}
