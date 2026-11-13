import { z } from 'zod';

import { capabilityTool, type CapabilityTool } from '#src/agent/tool-policy.js';
import {
  defaultBoardLanes,
  defaultBoardRecommendedTypes,
  type BoardDetail,
  type BoardLaneInput,
} from '#src/boards/index.js';
import { artifactRefCitation } from '#src/citation.js';
import { StaleWorkspaceStateError } from '#src/mutation-errors.js';
import { OBJECT_TYPES } from '#src/objects/types.js';
import { stableJson } from '#src/reconciliation/stable-json.js';

import type { TeamScope } from '#src/team-scope.js';

const id = z.uuid();
const revision = z.iso.datetime();
const reason = z.string().trim().min(1).max(1000);
const lane = z.object({
  id: id.optional(),
  name: z.string().trim().min(1).max(120),
  kind: z.enum(['active', 'done', 'terminal', 'lost', 'blocked']).nullable().optional(),
});
const settings = z.object({
  name: z.string().trim().min(1).max(120),
  purpose: z.string().trim().max(1000),
  lanes: z.array(lane).min(1).max(16),
  qualificationEnabled: z.boolean(),
  qualificationInstructions: z.string().trim().max(2000),
  strictObjectTypes: z.boolean(),
  recommendedObjectTypes: z.array(z.enum(OBJECT_TYPES)).max(32),
});
const noteState = z.object({ entityId: id, body: z.string(), updatedAt: revision });
const relationship = z.object({
  fromEntityId: id,
  toEntityId: id,
  kind: z.enum(['parent', 'child', 'related', 'blocks', 'blocked_by', 'duplicate_of']),
});

function boardLanes(lanes: z.output<typeof lane>[]): BoardLaneInput[] {
  return lanes.map((l) => ({ name: l.name, ...(l.id ? { id: l.id } : {}), kind: l.kind ?? null }));
}

function boardSnapshot(board: BoardDetail) {
  return {
    name: board.name,
    purpose: board.purpose,
    updatedAt: board.updatedAt.toISOString(),
    lanes: board.lanes.map((l) => ({ id: l.id, name: l.name, kind: l.kind })),
    qualificationEnabled: board.qualificationEnabled ?? false,
    qualificationInstructions: board.qualificationInstructions ?? '',
    strictObjectTypes: board.strictObjectTypes,
    recommendedObjectTypes: board.recommendedObjectTypes,
  };
}

export function buildWorkspaceTools(
  scope: TeamScope,
  runSafe: <T>(name: string, run: () => Promise<T>) => Promise<T | { error: string }>,
): Record<string, CapabilityTool> {
  const actor = { kind: 'agent' as const, userId: scope.userId };
  const objectCitation = (objectId: string) =>
    artifactRefCitation({ kind: 'object', id: objectId });
  function mutation<S extends z.ZodType>(
    name: string,
    description: string,
    schema: S,
    run: (input: z.output<S>) => Promise<unknown>,
  ): CapabilityTool {
    return capabilityTool({
      capability: 'mutation',
      userApproval: 'required',
      description: `Requires in-chat approval. ${description}`,
      inputSchema: schema,
      execute: (raw) => runSafe(name, () => run(schema.parse(raw))),
    });
  }
  const boardResult = (board: BoardDetail, message: string) => ({
    ok: true,
    board_id: board.id,
    board_citation: artifactRefCitation({ kind: 'board', id: board.id }),
    board: boardSnapshot(board),
    message,
  });
  return {
    get_board: capabilityTool({
      capability: 'read',
      description:
        'Read a visible board by ID, including ordered lane IDs, settings, and updatedAt for an approved edit. Use search_boards to resolve its ID first.',
      inputSchema: z.object({ boardId: id }),
      execute: (raw) =>
        runSafe('get_board', async () => {
          const { boardId } = z.object({ boardId: id }).parse(raw);
          const board = await scope.boards.getBoard(boardId, { itemLimit: 1 });
          return board ? boardResult(board, `Read ${board.name}.`) : { found: false };
        }),
    }),
    get_object_note: capabilityTool({
      capability: 'read',
      description:
        'Read a specific visible object note by ID, including its revision and author. Use before editing or deleting a note not present in get_object.',
      inputSchema: z.object({ noteId: id }),
      execute: (raw) =>
        runSafe('get_object_note', async () => {
          const { noteId } = z.object({ noteId: id }).parse(raw);
          const note = await scope.objects.getObjectNotePreview(noteId);
          return note
            ? {
                found: true,
                id: note.id,
                entityId: note.object.id,
                objectName: note.object.canonicalName,
                body: note.body,
                authorUserId: note.authorUserId,
                updatedAt: note.updatedAt.toISOString(),
                citation: artifactRefCitation({ kind: 'object_note', id: note.id }),
              }
            : { found: false };
        }),
    }),
    execute_board_create: mutation(
      'execute_board_create',
      'Create a board when explicitly requested. For CRM use templateKind pipeline. Omitted lanes and recommended types use the template defaults. Membership suggestions default off. Search for existing boards first; return the created board and lane IDs for subsequent card placement.',
      z.object({
        name: settings.shape.name,
        purpose: settings.shape.purpose.optional(),
        templateKind: z.enum(['pipeline', 'task_board', 'catalog', 'custom']),
        lanes: settings.shape.lanes.optional(),
        qualificationEnabled: z.boolean().optional(),
        qualificationInstructions: settings.shape.qualificationInstructions.optional(),
        strictObjectTypes: z.boolean().optional(),
        recommendedObjectTypes: settings.shape.recommendedObjectTypes.optional(),
        reason,
      }),
      async (input) => {
        const board = await scope.boards.createBoard({
          name: input.name,
          purpose: input.purpose ?? '',
          templateKind: input.templateKind,
          strictObjectTypes: input.strictObjectTypes ?? false,
          qualificationInstructions: input.qualificationInstructions ?? '',
          lanes: input.lanes ? boardLanes(input.lanes) : defaultBoardLanes(input.templateKind),
          recommendedObjectTypes:
            input.recommendedObjectTypes ?? defaultBoardRecommendedTypes(input.templateKind),
          qualificationEnabled: input.qualificationEnabled ?? false,
        });
        return boardResult(board, `Created ${board.name}.`);
      },
    ),
    execute_board_update: mutation(
      'execute_board_update',
      'Rename a board or update its purpose, lanes, and membership settings. Read get_board first and pass its complete board snapshot as expectedCurrent. Keep IDs for retained lanes. Removed lanes leave their cards unassigned; they do not delete objects.',
      z.object({
        boardId: id,
        expectedCurrent: settings.extend({ updatedAt: revision }),
        patch: settings.partial().refine((p) => Object.keys(p).length > 0, 'Provide a change'),
        reason,
      }),
      async (input) => {
        const current = await scope.boards.getBoard(input.boardId, { itemLimit: 1 });
        if (!current || stableJson(boardSnapshot(current)) !== stableJson(input.expectedCurrent))
          throw new StaleWorkspaceStateError();
        const p = input.patch;
        await scope.boards.updateBoardSettings({
          id: input.boardId,
          expectedUpdatedAt: input.expectedCurrent.updatedAt,
          ...(p.name !== undefined ? { name: p.name } : {}),
          ...(p.purpose !== undefined ? { purpose: p.purpose } : {}),
          ...(p.lanes ? { lanes: boardLanes(p.lanes) } : {}),
          ...(p.qualificationEnabled !== undefined
            ? { qualificationEnabled: p.qualificationEnabled }
            : {}),
          ...(p.qualificationInstructions !== undefined
            ? { qualificationInstructions: p.qualificationInstructions }
            : {}),
          ...(p.strictObjectTypes !== undefined ? { strictObjectTypes: p.strictObjectTypes } : {}),
          ...(p.recommendedObjectTypes !== undefined
            ? { recommendedObjectTypes: p.recommendedObjectTypes }
            : {}),
        });
        const updated = await scope.boards.getBoard(input.boardId, { itemLimit: 1 });
        if (!updated) throw new Error('Board unavailable after update');
        return boardResult(updated, `Updated ${updated.name}.`);
      },
    ),
    execute_board_archive: mutation(
      'execute_board_archive',
      'Archive a board after an explicit removal request. This preserves its objects. Read get_board first.',
      z.object({
        boardId: id,
        expectedCurrent: z.object({ name: settings.shape.name, updatedAt: revision }),
        reason,
      }),
      async (input) => {
        const current = await scope.boards.getBoard(input.boardId, { itemLimit: 1 });
        if (current?.name !== input.expectedCurrent.name) throw new StaleWorkspaceStateError();
        const ok = await scope.boards.archiveBoard(input.boardId, input.expectedCurrent.updatedAt);
        return {
          ok,
          board_id: input.boardId,
          board_citation: artifactRefCitation({ kind: 'board', id: input.boardId }),
          message: `Archived ${current.name}.`,
        };
      },
    ),
    execute_object_restore: mutation(
      'execute_object_restore',
      'Restore an archived object. Resolve it with search_objects archived=true and get_object first.',
      z.object({ entityId: id, expectedUpdatedAt: revision, reason }),
      async (input) => {
        const current = await scope.objects.getObject(input.entityId);
        if (!current?.archivedAt) throw new Error('Archived object not found');
        const restored = await scope.objects.unarchiveObject(
          input.entityId,
          actor,
          input.expectedUpdatedAt,
        );
        const reconciliation = await scope.suggestions
          .reconcileCanonicalChange({
            targetKind: restored.type === 'task' ? 'task' : 'object',
            targetId: restored.id,
            operation: 'update',
            patch: { archivedAt: null },
            reason: 'The user restored this object in chat.',
          })
          .then(
            () => 'completed',
            () => 'pending',
          );
        return {
          ok: true,
          object_id: restored.id,
          object_citation: objectCitation(restored.id),
          reconciliation,
          message: `Restored ${restored.canonicalName}.`,
        };
      },
    ),
    execute_object_note_create: mutation(
      'execute_object_note_create',
      'Add a note to an object when explicitly requested. Incidental memory still uses suggest_object_memory.',
      z.object({ entityId: id, body: z.string().trim().min(1).max(5000), reason }),
      async (input) => {
        const note = await scope.objects.createNote({
          entityId: input.entityId,
          body: input.body,
          authorUserId: scope.userId,
          actor,
        });
        return {
          ok: true,
          object_id: input.entityId,
          note_id: note.id,
          citation: artifactRefCitation({ kind: 'object_note', id: note.id }),
          message: 'Added note.',
        };
      },
    ),
    execute_object_note_update: mutation(
      'execute_object_note_update',
      'Edit a note authored by the current user. Read get_object or get_object_note first; expectedCurrent must match the note body, object, and revision.',
      z.object({
        noteId: id,
        expectedCurrent: noteState,
        body: z.string().trim().min(1).max(5000),
        reason,
      }),
      async (input) => {
        const ok = await scope.objects.updateNote({ ...input, actorUserId: scope.userId, actor });
        if (!ok) throw new Error('Note not found or not editable');
        return {
          ok,
          object_id: input.expectedCurrent.entityId,
          note_id: input.noteId,
          citation: artifactRefCitation({ kind: 'object_note', id: input.noteId }),
          message: 'Updated note.',
        };
      },
    ),
    execute_object_note_delete: mutation(
      'execute_object_note_delete',
      'Delete a note authored by the current user, after an explicit request. Read its current state first.',
      z.object({ noteId: id, expectedCurrent: noteState, reason }),
      async (input) => {
        const ok = await scope.objects.deleteNote({ ...input, actorUserId: scope.userId, actor });
        if (!ok) throw new Error('Note not found or not editable');
        return {
          ok,
          object_id: input.expectedCurrent.entityId,
          note_id: input.noteId,
          object_citation: objectCitation(input.expectedCurrent.entityId),
          message: 'Deleted note.',
        };
      },
    ),
    execute_object_relationship_add: mutation(
      'execute_object_relationship_add',
      'Link two resolved workspace objects after an explicit request. Kind and direction matter; use existing domain rules for primary company/project relationships.',
      relationship.extend({ reason }),
      async (input) => {
        const result = await scope.objects.addRelationship({
          ...input,
          actorUserId: scope.userId,
          actor,
        });
        if (!result) throw new Error('Objects not found or relationship unavailable');
        return {
          ok: true,
          relationship_id: result.id,
          object_ids: [input.fromEntityId, input.toEntityId],
          citations: [input.fromEntityId, input.toEntityId].map(objectCitation),
          message: `Linked objects (${input.kind}).`,
        };
      },
    ),
    execute_object_relationship_remove: mutation(
      'execute_object_relationship_remove',
      'Unlink objects after an explicit request. Read get_object to resolve the relationship ID and exact stored endpoints and kind first.',
      z.object({ relationshipId: id, expectedCurrent: relationship, reason }),
      async (input) => {
        const result = await scope.objects.removeRelationship(
          input.relationshipId,
          actor,
          input.expectedCurrent,
        );
        if (!result.removed) throw new Error('Relationship no longer available');
        return {
          ok: true,
          relationship_id: input.relationshipId,
          object_ids: result.touchedIds,
          citations: result.touchedIds.map(objectCitation),
          message: 'Removed relationship.',
        };
      },
    ),
  };
}
