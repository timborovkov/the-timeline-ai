import { describe, expect, it } from 'vitest';

import {
  CHAT_CONTEXT_TRAIL_MAX,
  chatContextKey,
  chatContextPrompt,
  chatContextTrailEqual,
  contextIdsFromTrail,
  mergeChatContextTrail,
  parseChatContextRef,
  parseChatContextTrail,
  pinnedObjectIdFromContext,
} from '#src/chat-context.js';

const objectA = {
  kind: 'object' as const,
  href: '/app/objects/44444444-4444-4444-8444-444444444444',
  label: 'Launch plan',
  objectId: '44444444-4444-4444-8444-444444444444',
};

const documentA = {
  kind: 'document' as const,
  href: '/app/documents/55555555-5555-4555-8555-555555555555',
  label: 'Q3 contract',
  documentId: '55555555-5555-4555-8555-555555555555',
};

const boardCard = {
  kind: 'board-item' as const,
  href: '/app/boards/66666666-6666-4666-8666-666666666666?item=77777777-7777-4777-8777-777777777777',
  label: 'Launch plan',
  objectId: '44444444-4444-4444-8444-444444444444',
  boardId: '66666666-6666-4666-8666-666666666666',
  boardItemId: '77777777-7777-4777-8777-777777777777',
};

describe('chat context trail', () => {
  it('rejects hrefs outside the app and empty labels', () => {
    expect(parseChatContextRef({ ...objectA, href: 'https://evil.example/app' })).toBeNull();
    expect(parseChatContextRef({ ...objectA, label: '   ' })).toBeNull();
    expect(parseChatContextRef({ ...objectA, kind: 'secret' })).toBeNull();
  });

  it('keeps the newest view first and does not drop earlier distinct views', () => {
    expect(mergeChatContextTrail([objectA], [documentA])).toEqual([documentA, objectA]);
    expect(chatContextKey(objectA)).toBe(`object:${objectA.objectId}`);
  });

  it('dedupes a return to the same view and refreshes its label', () => {
    const renamed = { ...objectA, label: 'Launch plan v2' };
    expect(mergeChatContextTrail([objectA, documentA], [renamed])).toEqual([renamed, documentA]);
  });

  it('caps the trail and prefers incoming views', () => {
    const incoming = Array.from({ length: CHAT_CONTEXT_TRAIL_MAX }, (_, index) => ({
      kind: 'page' as const,
      href: `/app/work?n=${String(index)}`,
      label: `Page ${String(index)}`,
    }));
    const older = {
      kind: 'page' as const,
      href: '/app/inbox',
      label: 'Inbox',
    };
    const merged = mergeChatContextTrail([older], incoming);
    expect(merged).toHaveLength(CHAT_CONTEXT_TRAIL_MAX);
    expect(merged[0]?.label).toBe('Page 0');
    expect(merged.some((ref) => ref.href === '/app/inbox')).toBe(false);
  });

  it('parses a stored trail and ignores junk', () => {
    expect(parseChatContextTrail([objectA, { kind: 'object' }, documentA])).toEqual([
      objectA,
      documentA,
    ]);
  });

  it('builds a prompt that prioritizes the current view and keeps earlier ids', () => {
    const prompt = chatContextPrompt([boardCard, documentA]);
    expect(prompt).toContain('CURRENT VIEW (priority)');
    expect(prompt).toContain('current_object_id: 44444444-4444-4444-8444-444444444444');
    expect(prompt).toContain('current_board_id: 66666666-6666-4666-8666-666666666666');
    expect(prompt).toContain('EARLIER VIEWS (background)');
    expect(prompt).toContain('earlier_document_id: 55555555-5555-4555-8555-555555555555');
    expect(prompt).toContain('search_app_guide');
  });

  it('collects the first ids in trail order and the first object pin', () => {
    expect(contextIdsFromTrail([documentA, boardCard])).toMatchObject({
      documentId: documentA.documentId,
      objectId: boardCard.objectId,
      boardId: boardCard.boardId,
    });
    expect(pinnedObjectIdFromContext([documentA, boardCard])).toBe(boardCard.objectId);
    expect(pinnedObjectIdFromContext([documentA])).toBeUndefined();
  });

  it('compares trails by key, href, and label', () => {
    expect(chatContextTrailEqual([objectA], [objectA])).toBe(true);
    expect(chatContextTrailEqual([objectA], [{ ...objectA, label: 'Renamed' }])).toBe(false);
    expect(chatContextTrailEqual([objectA], [documentA])).toBe(false);
  });
});
