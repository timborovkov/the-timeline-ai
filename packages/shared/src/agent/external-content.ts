/** Fence untrusted text so the model cannot treat it as system instructions. */
export function fenceExternalContent(
  text: string | null | undefined,
  attrs: { source: string; eventId: string },
): string | null {
  if (text === null || text === undefined) return null;
  const sanitized = text.replace(/<\/?external_content[^>]*>/gi, '[fence-removed]');
  return `<external_content source="${fenceAttribute(attrs.source)}" event_id="${fenceAttribute(attrs.eventId)}">${sanitized}</external_content>`;
}

function fenceAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
