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
 *  - `[ev:<id>]` → `/app/timeline?event=<id>#ev-<id>` (loads + scrolls to the row)
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
      {blocks.map((block) => {
        const key = block.key;
        switch (block.type) {
          case 'ul':
            return (
              <ul key={key} className="ml-5 list-disc space-y-1 marker:text-fg-dim">
                {block.items.map((item) => (
                  <li key={item.key}>
                    <InlineText keyPrefix={item.key} text={item.text} />
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
                {block.items.map((item) => (
                  <li key={item.key} value={item.value}>
                    <InlineText keyPrefix={item.key} text={item.text} />
                  </li>
                ))}
              </ol>
            );
          case 'heading':
            return (
              <p key={key} className="font-semibold text-fg">
                <InlineText keyPrefix={key} text={block.text} />
              </p>
            );
          case 'table':
            return (
              <div key={key} className="overflow-x-auto rounded-sm border border-border bg-surface">
                <table className="w-full min-w-[680px] border-collapse text-left text-[0.95em]">
                  <thead className="border-b border-border bg-bg font-mono text-[10px] uppercase tracking-[0.12em] text-fg-dim">
                    <tr>
                      {block.headers.map((cell, cellIndex) => (
                        <th
                          key={`${key}:head:${String(cellIndex)}`}
                          scope="col"
                          className="px-3 py-2 align-top font-medium"
                        >
                          <InlineText keyPrefix={`${key}:head:${String(cellIndex)}`} text={cell} />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {block.rows.map((row, rowIndex) => (
                      <tr key={`${key}:row:${String(rowIndex)}`}>
                        {block.headers.map((_, cellIndex) => (
                          <td
                            key={`${key}:cell:${String(rowIndex)}:${String(cellIndex)}`}
                            className="px-3 py-2 align-top"
                          >
                            <InlineText
                              keyPrefix={`${key}:cell:${String(rowIndex)}:${String(cellIndex)}`}
                              text={row[cellIndex] ?? ''}
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          case 'paragraph':
            return (
              <p key={key}>
                <InlineText keyPrefix={key} text={block.text} />
              </p>
            );
        }
      })}
    </div>
  );
}

type MarkdownBlock =
  | { type: 'paragraph'; key: string; text: string }
  | { type: 'heading'; key: string; text: string }
  | { type: 'table'; key: string; headers: string[]; rows: string[][] }
  | { type: 'ul'; key: string; items: MarkdownListItem[] }
  | { type: 'ol'; key: string; items: OrderedMarkdownListItem[] };

interface MarkdownListItem {
  key: string;
  text: string;
}

interface OrderedMarkdownListItem extends MarkdownListItem {
  value: number;
}

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
      blocks.push({
        type: 'heading',
        key: blockKey('heading', index, line),
        text: heading[2].trim(),
      });
      index += 1;
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      const start = index;
      const items: MarkdownListItem[] = [];
      while (index < lines.length && /^[-*]\s+/.test(lines[index] ?? '')) {
        const itemLine = lines[index] ?? '';
        items.push({
          key: blockKey('ul-item', index, itemLine),
          text: itemLine.replace(/^[-*]\s+/, '').trim(),
        });
        index += 1;
      }
      blocks.push({ type: 'ul', key: blockKey('ul', start, line), items });
      continue;
    }

    const nextLine = lines[index + 1] ?? '';
    if (isTableRow(line) && isTableDivider(nextLine)) {
      const start = index;
      const headers = splitTableRow(line);
      index += 2;
      const rows: string[][] = [];
      while (index < lines.length && isTableRow(lines[index] ?? '')) {
        rows.push(splitTableRow(lines[index] ?? ''));
        index += 1;
      }
      blocks.push({ type: 'table', key: blockKey('table', start, line), headers, rows });
      continue;
    }

    if (/^1[.)]\s+/.test(line)) {
      const start = index;
      const items: OrderedMarkdownListItem[] = [];
      while (index < lines.length && /^\d+[.)]\s+/.test(lines[index] ?? '')) {
        const itemLine = lines[index] ?? '';
        const item = /^(\d+)[.)]\s+(.+)$/.exec(itemLine);
        if (item?.[1] && item[2]) {
          items.push({
            key: blockKey('ol-item', index, itemLine),
            value: Number(item[1]),
            text: item[2].trim(),
          });
        }
        index += 1;
      }
      blocks.push({ type: 'ol', key: blockKey('ol', start, line), items });
      continue;
    }

    const start = index;
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
    const text = paragraph.join('\n');
    blocks.push({ type: 'paragraph', key: blockKey('paragraph', start, text), text });
  }

  return blocks;
}

function isTableRow(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.split('|').length > 1;
}

function isTableDivider(line: string): boolean {
  if (!isTableRow(line)) return false;
  const cells = splitTableRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
}

function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

function blockKey(type: string, line: number, text: string): string {
  return `${type}:${String(line)}:${text.slice(0, 24)}`;
}

function InlineText({ text, keyPrefix }: { text: string; keyPrefix: string }) {
  const parts = parseCitations(text);
  let cursor = 0;

  return (
    <>
      {parts.map((p) => {
        const start = cursor;
        if (p.type === 'text') cursor += p.value.length;
        else if (p.type === 'doc') cursor += p.documentId.length + p.chunkId.length;
        else cursor += p.value.length;
        const key = `${keyPrefix}:${p.type}:${String(start)}:${String(cursor)}`;
        if (p.type === 'text') return <StrongText key={key} keyPrefix={key} text={p.value} />;
        if (p.type === 'ev') {
          return (
            <span key={key} className="mx-0.5">
              <CitationChip
                id={`ev:${p.value.slice(0, 8)}`}
                source="Event"
                href={`/app/timeline?event=${p.value}#ev-${p.value}`}
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
      })}
    </>
  );
}

function StrongText({ text, keyPrefix }: { text: string; keyPrefix: string }) {
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
  return <Fragment>{nodes}</Fragment>;
}
