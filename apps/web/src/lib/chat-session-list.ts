export interface ChatSessionListEntry {
  id: string;
  surface: string;
  title: string | null;
  pinnedEntityId: string | null;
  pinnedEntityName: string | null;
  updatedAt: string;
}

export function chatSessionLabel(session: {
  title: string | null;
  pinnedEntityName: string | null;
}): string {
  return (
    session.title ??
    (session.pinnedEntityName ? `Chat about ${session.pinnedEntityName}` : 'Untitled chat')
  );
}

export function filterChatSessions<
  T extends { title: string | null; pinnedEntityName: string | null },
>(sessions: T[], query: string): T[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return sessions;
  return sessions.filter((session) => {
    const haystack = [chatSessionLabel(session), session.pinnedEntityName]
      .filter((value): value is string => Boolean(value))
      .join(' ')
      .toLowerCase();
    return haystack.includes(needle);
  });
}
