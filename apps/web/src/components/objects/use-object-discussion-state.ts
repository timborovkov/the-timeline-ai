'use client';

import { useRouter } from 'next/navigation';
import { useReducer, useTransition } from 'react';

import type * as objects from '@timeline/shared/objects/types';

import { createNoteAction, deleteNoteAction, updateNoteAction } from '@/app/actions/objects';
import { notifyAction } from '@/lib/notify';

interface DiscussionUiState {
  noteBody: string;
  editingNoteId: string | null;
  editingBody: string;
}

type DiscussionUiAction =
  | Partial<DiscussionUiState>
  | ((state: DiscussionUiState) => DiscussionUiState);

function discussionUiReducer(
  state: DiscussionUiState,
  action: DiscussionUiAction,
): DiscussionUiState {
  return typeof action === 'function' ? action(state) : { ...state, ...action };
}

export function useObjectDiscussionState(input: {
  entityId: string;
  notes: objects.ObjectDetail['notes'];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [ui, dispatchUi] = useReducer(discussionUiReducer, {
    noteBody: '',
    editingNoteId: null,
    editingBody: '',
  });

  function addNote(): void {
    const body = ui.noteBody.trim();
    if (!body) return;
    startTransition(async () => {
      const result = await notifyAction({
        id: `object:${input.entityId}:note:add`,
        loading: 'Posting comment…',
        success: 'Comment posted',
        error: 'Couldn’t post comment',
        run: () => createNoteAction({ entityId: input.entityId, body }),
      });
      if (!result.error) {
        dispatchUi({ noteBody: '' });
        router.refresh();
      }
    });
  }

  function saveNote(): void {
    const noteId = ui.editingNoteId;
    if (!noteId) return;
    const body = ui.editingBody.trim();
    if (!body) return;
    startTransition(async () => {
      const result = await notifyAction({
        id: `object:${input.entityId}:note:${noteId}`,
        loading: 'Saving comment…',
        success: 'Comment saved',
        error: 'Couldn’t save comment',
        run: () => updateNoteAction({ noteId, entityId: input.entityId, body }),
      });
      if (!result.error) {
        dispatchUi({ editingNoteId: null, editingBody: '' });
        router.refresh();
      }
    });
  }

  function deleteNote(noteId: string): void {
    startTransition(async () => {
      const result = await notifyAction({
        id: `object:${input.entityId}:note:${noteId}:delete`,
        loading: 'Deleting comment…',
        success: 'Comment deleted',
        error: 'Couldn’t delete comment',
        run: () => deleteNoteAction({ noteId, entityId: input.entityId }),
      });
      if (!result.error) router.refresh();
    });
  }

  return {
    pending,
    noteBody: ui.noteBody,
    editingNoteId: ui.editingNoteId,
    editingBody: ui.editingBody,
    dispatchObjectUi: dispatchUi,
    addNote,
    saveNote,
    deleteNote,
  };
}
