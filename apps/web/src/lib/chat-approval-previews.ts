export const workspaceMutationPreviews = [
  'execute_board_create',
  'execute_board_update',
  'execute_board_archive',
  'execute_board_add_item',
  'execute_board_update_item',
  'execute_board_remove_item',
  'execute_object_restore',
  'execute_object_note_create',
  'execute_object_note_update',
  'execute_object_note_delete',
  'execute_object_relationship_add',
  'execute_object_relationship_remove',
];

export const dedicatedMutationPreviews = [
  'execute_object_create',
  'execute_object_update',
  'execute_calendar_create',
  'execute_calendar_update',
  'execute_calendar_cancel',
  'execute_object_archive',
  'execute_object_merge',
] as const;
export function hasToolApprovalPreview(name: string): boolean {
  return (
    workspaceMutationPreviews.includes(name) ||
    dedicatedMutationPreviews.some((entry) => entry === name)
  );
}
