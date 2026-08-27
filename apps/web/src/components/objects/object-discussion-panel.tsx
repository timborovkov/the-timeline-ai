'use client';

import {
  AGENT_DISPLAY_NAME,
  AGENT_INSERT_TOKEN,
  isAgentMentionToken,
  matchesAgentMentionQuery,
  mentionInsertToken,
  type MentionMember,
} from '@timeline/shared/objects/mentions';
import Link from 'next/link';
import {
  type Dispatch,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import type { ObjectDetail } from '@timeline/shared/objects/types';

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useWorkspaceTimezone } from '@/components/workspace-timezone-context';
import { formatDisplayDateTime, formatRelativeAge } from '@/lib/display-dates';
import { cn } from '@/lib/utils';

export interface DiscussionMember {
  id: string;
  label: string;
  name?: string;
  email?: string;
}

type DiscussionUiAction =
  | { noteBody: string }
  | { editingNoteId: string | null; editingBody?: string }
  | { editingBody: string };

interface Props {
  notes: ObjectDetail['notes'];
  recentChanges: ObjectDetail['recentChanges'];
  userId: string;
  members: DiscussionMember[];
  pending: boolean;
  noteBody: string;
  editingNoteId: string | null;
  editingBody: string;
  highlightCommentId?: string | null;
  dispatchObjectUi: Dispatch<DiscussionUiAction>;
  onAddNote: () => void;
  onSaveNote: (noteId: string, body: string) => void;
  onDeleteNote: (noteId: string) => void;
}

function nonempty(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return trimmed;
}

function toMentionMembers(members: DiscussionMember[]): MentionMember[] {
  return members.map((member) => ({
    userId: member.id,
    name: nonempty(member.name) ?? member.label,
    email: member.email ?? '',
  }));
}

function mentionChipLabel(token: string, members: DiscussionMember[]): string {
  if (isAgentMentionToken(token)) return AGENT_DISPLAY_NAME;
  const lower = token.toLowerCase();
  const hit = members.find((member) => {
    const displayName = nonempty(member.name) ?? member.label;
    const compact = displayName.replace(/[^A-Za-z0-9._-]/g, '');
    const first = displayName.split(/\s+/)[0] ?? '';
    const local = member.email?.split('@')[0] ?? '';
    return [compact, first, local].some((value) => value.toLowerCase() === lower);
  });
  return hit?.label ?? token;
}

function activitySummary(change: ObjectDetail['recentChanges'][number]): string {
  const actor =
    nonempty(change.actorName) ?? (change.actorKind === 'agent' ? AGENT_DISPLAY_NAME : 'Someone');
  return `${actor} updated ${change.field}`;
}

export function ObjectDiscussionPanel({
  notes,
  recentChanges,
  userId,
  members,
  pending,
  noteBody,
  editingNoteId,
  editingBody,
  highlightCommentId,
  dispatchObjectUi,
  onAddNote,
  onSaveNote,
  onDeleteNote,
}: Props) {
  const timezone = useWorkspaceTimezone();
  const mentionMembers = useMemo(() => toMentionMembers(members), [members]);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [suggestQuery, setSuggestQuery] = useState('');
  const [suggestIndex, setSuggestIndex] = useState(0);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  const feed = useMemo(() => {
    const comments = notes.map((note) => ({
      id: `note:${note.id}`,
      at: new Date(note.createdAt).getTime(),
      kind: 'comment' as const,
      note,
    }));
    const activity: {
      id: string;
      at: number;
      kind: 'activity';
      change: ObjectDetail['recentChanges'][number];
    }[] = [];
    for (const change of recentChanges) {
      if (change.status !== 'applied') continue;
      activity.push({
        id: `change:${change.id}`,
        at: new Date(change.changedAt).getTime(),
        kind: 'activity',
        change,
      });
    }
    return [...comments, ...activity].sort(
      (left, right) => left.at - right.at || left.id.localeCompare(right.id),
    );
  }, [notes, recentChanges]);

  useEffect(() => {
    if (!highlightCommentId) return;
    document.getElementById(`comment-${highlightCommentId}`)?.scrollIntoView({
      block: 'center',
      behavior: 'smooth',
    });
  }, [highlightCommentId, notes]);

  const suggestions = useMemo(() => {
    if (!suggestOpen) return [];
    const query = suggestQuery.toLowerCase();
    const people = members.filter((member) => {
      const haystack = `${member.label} ${member.name ?? ''} ${member.email ?? ''}`.toLowerCase();
      return query.length === 0 || haystack.includes(query);
    });
    const agent: DiscussionMember[] = matchesAgentMentionQuery(query)
      ? [
          {
            id: 'timeline',
            label: AGENT_DISPLAY_NAME,
            name: AGENT_DISPLAY_NAME,
            email: '',
          },
        ]
      : [];
    return [...agent, ...people].slice(0, 8);
  }, [members, suggestOpen, suggestQuery]);

  function insertMention(member: DiscussionMember): void {
    const textarea = composerRef.current;
    const token =
      member.id === 'timeline'
        ? AGENT_INSERT_TOKEN
        : mentionInsertToken(
            {
              userId: member.id,
              name: nonempty(member.name) ?? member.label,
              email: member.email ?? '',
            },
            mentionMembers,
          );
    const caret = textarea?.selectionStart ?? noteBody.length;
    const before = noteBody.slice(0, caret);
    const at = before.lastIndexOf('@');
    const prefix = at >= 0 ? before.slice(0, at) : before;
    const next = `${prefix}@${token} ${noteBody.slice(caret)}`;
    const caretPos = prefix.length + token.length + 2;
    dispatchObjectUi({ noteBody: next });
    setSuggestOpen(false);
    setSuggestQuery('');
    queueMicrotask(() => {
      const node = composerRef.current;
      if (!node) return;
      node.focus();
      node.setSelectionRange(caretPos, caretPos);
    });
  }

  function onComposerChange(value: string, caret: number): void {
    dispatchObjectUi({ noteBody: value });
    const before = value.slice(0, caret);
    const at = before.lastIndexOf('@');
    if (at < 0) {
      setSuggestOpen(false);
      return;
    }
    const token = before.slice(at + 1);
    if (token.includes(' ') || token.includes('\n')) {
      setSuggestOpen(false);
      return;
    }
    setSuggestOpen(true);
    setSuggestQuery(token);
    setSuggestIndex(0);
  }

  function onComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (suggestOpen && suggestions.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setSuggestIndex((index) => (index + 1) % suggestions.length);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setSuggestIndex((index) => (index - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        const selected = suggestions[suggestIndex] ?? suggestions[0];
        if (selected) insertMention(selected);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        setSuggestOpen(false);
        return;
      }
    }
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && noteBody.trim()) {
      event.preventDefault();
      onAddNote();
    }
  }

  return (
    <section>
      <h2 className="mb-1.5 text-xs font-medium text-fg-dim">Discussion</h2>
      <ol className="space-y-2">
        {feed.map((item) => {
          if (item.kind === 'activity') {
            return (
              <li key={item.id} className="text-xs font-normal text-fg-dim">
                <RelativeTime at={new Date(item.at)} timezone={timezone} />
                <span className="ml-1.5">{activitySummary(item.change)}</span>
              </li>
            );
          }
          const note = item.note;
          const isOwner = note.authorUserId === userId;
          const isEditing = editingNoteId === note.id;
          const author =
            nonempty(note.authorName) ?? (note.authorUserId ? 'Member' : AGENT_DISPLAY_NAME);
          return (
            <li
              key={note.id}
              id={`comment-${note.id}`}
              className={cn(
                'rounded-sm px-1 py-1 text-sm',
                highlightCommentId === note.id && 'bg-signal/10',
              )}
            >
              <div className="flex items-baseline justify-between gap-2 text-xs font-normal text-fg-dim">
                <span className="text-sm font-normal text-fg">{author}</span>
                <RelativeTime at={new Date(note.createdAt)} timezone={timezone} />
              </div>
              {isEditing ? (
                <div className="mt-1 space-y-1.5">
                  <textarea
                    aria-label="Edit comment"
                    value={editingBody}
                    onChange={(event) => {
                      dispatchObjectUi({ editingBody: event.target.value });
                    }}
                    className="w-full border-0 border-b border-border bg-transparent px-0 py-1.5 text-sm font-normal text-fg outline-none focus-visible:border-signal"
                    rows={3}
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={pending || !editingBody.trim()}
                      onClick={() => {
                        onSaveNote(note.id, editingBody);
                      }}
                      className="text-xs font-normal text-fg-dim hover:underline"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        dispatchObjectUi({ editingNoteId: null });
                      }}
                      className="text-xs font-normal text-fg-dim hover:underline"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <p className="mt-0.5 whitespace-pre-wrap text-sm font-normal text-fg">
                  <RichCommentBody body={note.body} members={members} />
                </p>
              )}
              {isOwner && !isEditing ? (
                <div className="mt-0.5 flex gap-2 text-xs font-normal text-fg-dim">
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => {
                      dispatchObjectUi({ editingNoteId: note.id, editingBody: note.body });
                    }}
                    className="hover:underline"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => {
                      onDeleteNote(note.id);
                    }}
                    className="hover:underline"
                  >
                    Delete
                  </button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
      <DiscussionComposer
        composerRef={composerRef}
        noteBody={noteBody}
        pending={pending}
        suggestions={suggestions}
        suggestOpen={suggestOpen}
        suggestIndex={suggestIndex}
        onChange={onComposerChange}
        onKeyDown={onComposerKeyDown}
        onAddNote={onAddNote}
        onPickMention={insertMention}
      />
    </section>
  );
}

// react-doctor-disable-next-line react-doctor/no-multi-comp -- Composer + mention list stay local to the discussion thread.
function DiscussionComposer({
  composerRef,
  noteBody,
  pending,
  suggestions,
  suggestOpen,
  suggestIndex,
  onChange,
  onKeyDown,
  onAddNote,
  onPickMention,
}: {
  composerRef: RefObject<HTMLTextAreaElement | null>;
  noteBody: string;
  pending: boolean;
  suggestions: DiscussionMember[];
  suggestOpen: boolean;
  suggestIndex: number;
  onChange: (value: string, caret: number) => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onAddNote: () => void;
  onPickMention: (member: DiscussionMember) => void;
}) {
  const highlight = suggestions.length === 0 ? 0 : Math.min(suggestIndex, suggestions.length - 1);
  return (
    <div className="relative mt-3">
      <textarea
        ref={composerRef}
        aria-label="New comment"
        value={noteBody}
        onChange={(event) => {
          onChange(event.target.value, event.target.selectionStart);
        }}
        onKeyDown={onKeyDown}
        placeholder={`Comment, @mention people or @${AGENT_DISPLAY_NAME}`}
        className="w-full border-0 border-b border-border bg-transparent px-0 py-1.5 text-sm font-normal text-fg outline-none focus-visible:border-signal"
        rows={2}
      />
      {suggestOpen && suggestions.length > 0 ? (
        <ul className="absolute z-20 mt-1 max-h-48 w-full overflow-auto rounded-sm border border-border bg-surface py-1 shadow-sm">
          {suggestions.map((member, index) => (
            <li key={member.id}>
              <button
                type="button"
                className={cn(
                  'flex w-full px-2 py-1 text-left text-sm font-normal text-fg hover:bg-surface-2',
                  index === highlight && 'bg-surface-2',
                )}
                onMouseDown={(event) => {
                  event.preventDefault();
                  onPickMention(member);
                }}
              >
                {member.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <button
        type="button"
        onClick={onAddNote}
        disabled={pending || !noteBody.trim()}
        className="mt-1.5 text-xs font-normal text-fg-dim hover:underline disabled:text-fg-dim/70"
      >
        Comment
      </button>
    </div>
  );
}

const TOKEN_RE = /@([A-Za-z0-9._-]+)|(https?:\/\/[^\s<]+[^\.\s<])/g;

// react-doctor-disable-next-line react-doctor/no-multi-comp -- Mention chips and autolinks are local to discussion comments.
function RichCommentBody({ body, members }: { body: string; members: DiscussionMember[] }) {
  const matches: { start: number; end: number; token?: string; url?: string }[] = [];
  for (const match of body.matchAll(TOKEN_RE)) {
    matches.push(
      match[2]
        ? { start: match.index, end: match.index + match[0].length, url: match[2] }
        : { start: match.index, end: match.index + match[0].length, token: match[1] },
    );
  }
  matches.sort((left, right) => left.start - right.start || left.end - right.end);
  const kept: typeof matches = [];
  for (const match of matches) {
    if (kept.some((item) => item.start < match.end && match.start < item.end)) continue;
    kept.push(match);
  }
  const nodes: ReactNode[] = [];
  let cursor = 0;
  kept.forEach((match, index) => {
    if (match.start > cursor) nodes.push(body.slice(cursor, match.start));
    if (match.url) {
      nodes.push(
        <Link
          key={`url-${String(index)}`}
          href={match.url}
          className="text-signal underline decoration-signal/40 underline-offset-2"
          target="_blank"
          rel="noreferrer"
        >
          {match.url}
        </Link>,
      );
    } else {
      nodes.push(
        <span
          key={`mention-${String(index)}`}
          className="rounded-sm bg-signal/10 px-0.5 font-normal text-signal"
        >
          @{mentionChipLabel(match.token ?? '', members)}
        </span>,
      );
    }
    cursor = match.end;
  });
  if (cursor < body.length) nodes.push(body.slice(cursor));
  return nodes;
}

// react-doctor-disable-next-line react-doctor/no-multi-comp -- Absolute timestamps live in a tooltip next to relative age.
function RelativeTime({ at, timezone }: { at: Date; timezone: string }) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <time dateTime={at.toISOString()} className="tabular-nums font-normal text-fg-dim">
            {formatRelativeAge(at)}
          </time>
        </TooltipTrigger>
        <TooltipContent>{formatDisplayDateTime(at, { timezone })}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
