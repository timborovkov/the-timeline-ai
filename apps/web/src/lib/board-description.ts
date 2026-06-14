const LEGACY_TEMPLATE_DESCRIPTIONS = new Set([
  'Track companies, deals, or projects through staged progress.',
  'Track tasks and follow-ups through an operational workflow.',
  'Track products, services, vendors, documents, or reference objects in one curated inventory.',
  'Track a curated set of workspace objects for a team-defined workflow.',
]);

export function visibleBoardDescription(value: string | null | undefined): string | null {
  const description = value?.trim();
  if (!description || LEGACY_TEMPLATE_DESCRIPTIONS.has(description)) return null;
  return description;
}
