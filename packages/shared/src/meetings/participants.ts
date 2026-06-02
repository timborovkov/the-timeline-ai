export function participantNames(participants: unknown): string[] {
  if (!Array.isArray(participants)) return [];
  return participants
    .map((participant) => {
      if (!participant || typeof participant !== 'object') return null;
      const record = participant as Record<string, unknown>;
      const name = typeof record.name === 'string' ? record.name.trim() : '';
      const email = typeof record.email === 'string' ? record.email.trim() : '';
      return name || email || null;
    })
    .filter((value): value is string => Boolean(value));
}
