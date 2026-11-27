export const CHAT_TITLE_MAX_LENGTH = 48;

export function normalizeChatTitle(title: string): string {
  const compact = title.replace(/\s+/g, ' ').trim();
  return (compact || 'New chat').slice(0, CHAT_TITLE_MAX_LENGTH).trim() || 'New chat';
}

export function uniqueChatTitle(title: string, existingTitles: string[]): string {
  const baseTitle = normalizeChatTitle(title);
  const seen = new Set(existingTitles.map((value) => value.toLowerCase()));
  if (!seen.has(baseTitle.toLowerCase())) return baseTitle;
  for (let n = 2; n < 100; n += 1) {
    const suffix = ` ${n}`;
    const base = baseTitle.slice(0, CHAT_TITLE_MAX_LENGTH - suffix.length).trim();
    const candidate = `${base}${suffix}`;
    if (!seen.has(candidate.toLowerCase())) return candidate;
  }
  return `${baseTitle.slice(0, CHAT_TITLE_MAX_LENGTH - 4).trim()} ${Date.now()
    .toString()
    .slice(-3)}`;
}
