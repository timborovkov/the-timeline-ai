type VisibilityValue = 'private' | 'team' | 'specific_users';

export function normalizeVisibilityUserIds(
  visibility: VisibilityValue,
  ids: string[] | null | undefined,
): string[] | null {
  if (visibility !== 'specific_users') return null;
  const clean = [...new Set(ids ?? [])];
  if (clean.length === 0) throw new Error('specific_users visibility requires at least one user');
  return clean;
}

export async function validateVisibilityUserIds(
  visibility: VisibilityValue,
  ids: string[] | null | undefined,
  requireTeamMember?: (userId: string) => Promise<void>,
): Promise<string[] | null> {
  const clean = normalizeVisibilityUserIds(visibility, ids);
  if (clean && requireTeamMember) {
    for (const uid of clean) await requireTeamMember(uid);
  }
  return clean;
}
